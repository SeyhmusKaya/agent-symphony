<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Editor } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";
  import Placeholder from "@tiptap/extension-placeholder";
  import TaskList from "@tiptap/extension-task-list";
  import TaskItem from "@tiptap/extension-task-item";
  import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
  import Image from "@tiptap/extension-image";
  import { createLowlight, common } from "lowlight";

  interface Props {
    value: string;
    onChange: (html: string, text: string) => void;
    placeholder?: string;
    debounceMs?: number;
  }

  let { value, onChange, placeholder = "Type '/' for blocks…", debounceMs = 600 }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let editor = $state.raw<Editor | null>(null);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Slash menu state
  let slashOpen = $state(false);
  let slashPos = $state({ top: 0, left: 0 });
  let slashIndex = $state(0);

  type SlashCmd = {
    label: string;
    hint: string;
    run: (e: Editor) => void;
  };

  const slashItems: SlashCmd[] = [
    { label: "Heading 1", hint: "H1", run: (e) => e.chain().focus().deleteRange(slashRange()).toggleHeading({ level: 1 }).run() },
    { label: "Heading 2", hint: "H2", run: (e) => e.chain().focus().deleteRange(slashRange()).toggleHeading({ level: 2 }).run() },
    { label: "Heading 3", hint: "H3", run: (e) => e.chain().focus().deleteRange(slashRange()).toggleHeading({ level: 3 }).run() },
    { label: "Bulleted list", hint: "•", run: (e) => e.chain().focus().deleteRange(slashRange()).toggleBulletList().run() },
    { label: "Numbered list", hint: "1.", run: (e) => e.chain().focus().deleteRange(slashRange()).toggleOrderedList().run() },
    { label: "To-do", hint: "☑", run: (e) => e.chain().focus().deleteRange(slashRange()).toggleTaskList().run() },
    { label: "Quote", hint: "“”", run: (e) => e.chain().focus().deleteRange(slashRange()).toggleBlockquote().run() },
    { label: "Code block", hint: "</>", run: (e) => e.chain().focus().deleteRange(slashRange()).toggleCodeBlock().run() },
    { label: "Divider", hint: "—", run: (e) => e.chain().focus().deleteRange(slashRange()).setHorizontalRule().run() },
  ];

  let slashFrom = 0;
  let slashTo = 0;
  function slashRange() {
    return { from: slashFrom, to: slashTo };
  }

  function closeSlash() {
    slashOpen = false;
    slashIndex = 0;
  }

  function runSlash(i: number) {
    if (!editor) return;
    const item = slashItems[i];
    if (!item) return;
    item.run(editor);
    closeSlash();
  }

  function detectSlash() {
    if (!editor) return;
    const { state } = editor;
    const { from } = state.selection;
    // look back to find a "/" at start of token within current line
    const resolved = state.doc.resolve(from);
    const lineStart = resolved.start();
    const textBefore = state.doc.textBetween(lineStart, from, "\n", "\n");
    const m = /(^|\s)\/([\w]*)$/.exec(textBefore);
    if (!m) {
      closeSlash();
      return;
    }
    const offset = m.index + (m[1] ? m[1].length : 0); // position of "/"
    slashFrom = lineStart + offset;
    slashTo = from;
    // position the menu below the caret
    try {
      const coords = editor.view.coordsAtPos(from);
      const hostRect = host!.getBoundingClientRect();
      slashPos = { top: coords.bottom - hostRect.top + 4, left: coords.left - hostRect.left };
    } catch {
      // ignore
    }
    slashOpen = true;
    // filter is implicit via filtered() below
  }

  const filteredSlash = $derived.by(() => {
    if (!slashOpen) return slashItems;
    // re-derive query from current selection
    if (!editor) return slashItems;
    try {
      const { state } = editor;
      const q = state.doc.textBetween(slashFrom + 1, state.selection.from).toLowerCase();
      if (!q) return slashItems;
      return slashItems.filter((s) => s.label.toLowerCase().includes(q));
    } catch {
      return slashItems;
    }
  });

  function onKeyDown(e: KeyboardEvent) {
    if (!slashOpen) return;
    const list = filteredSlash;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      slashIndex = (slashIndex + 1) % Math.max(list.length, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      slashIndex = (slashIndex - 1 + Math.max(list.length, 1)) % Math.max(list.length, 1);
    } else if (e.key === "Enter") {
      if (list.length) {
        e.preventDefault();
        const real = slashItems.indexOf(list[slashIndex]);
        runSlash(real);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSlash();
    }
  }

  function emit() {
    if (!editor) return;
    const html = editor.getHTML();
    const text = editor.getText();
    onChange(html, text);
  }

  function scheduleEmit() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(emit, debounceMs);
  }

  // toolbar reactivity
  let active = $state({ bold: false, italic: false, strike: false, h1: false, h2: false, ul: false, ol: false, task: false, code: false });
  function refreshActive() {
    if (!editor) return;
    active = {
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      strike: editor.isActive("strike"),
      h1: editor.isActive("heading", { level: 1 }),
      h2: editor.isActive("heading", { level: 2 }),
      ul: editor.isActive("bulletList"),
      ol: editor.isActive("orderedList"),
      task: editor.isActive("taskList"),
      code: editor.isActive("codeBlock"),
    };
  }

  onMount(() => {
    if (!host) return;
    const lowlight = createLowlight(common);
    editor = new Editor({
      element: host,
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        Placeholder.configure({ placeholder }),
        TaskList,
        TaskItem.configure({ nested: true }),
        CodeBlockLowlight.configure({ lowlight }),
        Image.configure({ inline: false, allowBase64: true }),
      ],
      content: value || "",
      editorProps: {
        handlePaste(_view, event) {
          const items = event.clipboardData?.items;
          if (!items) return false;
          for (const it of items) {
            if (it.kind === "file" && it.type.startsWith("image/")) {
              const file = it.getAsFile();
              if (file) {
                event.preventDefault();
                void insertImageFile(file);
                return true;
              }
            }
          }
          return false;
        },
        handleDrop(_view, event) {
          const files = event.dataTransfer?.files;
          if (!files || files.length === 0) return false;
          let handled = false;
          for (const f of files) {
            if (f.type.startsWith("image/")) {
              event.preventDefault();
              void insertImageFile(f);
              handled = true;
            }
          }
          return handled;
        },
      },
      onUpdate: () => {
        scheduleEmit();
        detectSlash();
        refreshActive();
      },
      onSelectionUpdate: () => {
        detectSlash();
        refreshActive();
      },
    });
    refreshActive();
  });

  async function insertImageFile(file: File) {
    if (!editor) return;
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    editor.chain().focus().setImage({ src: base64 }).run();
  }

  function pickImage() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (f) void insertImageFile(f);
    };
    inp.click();
  }

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (editor) {
      // flush
      try {
        emit();
      } catch {
        // ignore
      }
      editor.destroy();
      editor = null;
    }
  });

  // External value sync (e.g. switching notes)
  let lastSetValue = "";
  $effect(() => {
    if (!editor) return;
    if (value === lastSetValue) return;
    editor.commands.setContent(value || "", { emitUpdate: false });
    lastSetValue = value;
  });

  function cmd(fn: (e: Editor) => void) {
    if (!editor) return;
    fn(editor);
    editor.commands.focus();
    refreshActive();
  }
</script>

<div class="be" onkeydown={onKeyDown} role="presentation">
  <div class="be-toolbar">
    <button type="button" title="Undo" onclick={() => cmd((e) => e.chain().undo().run())}>↶</button>
    <button type="button" title="Redo" onclick={() => cmd((e) => e.chain().redo().run())}>↷</button>
    <span class="be-sep"></span>
    <button type="button" class:on={active.bold} title="Bold" onclick={() => cmd((e) => e.chain().toggleBold().run())}><b>B</b></button>
    <button type="button" class:on={active.italic} title="Italic" onclick={() => cmd((e) => e.chain().toggleItalic().run())}><i>I</i></button>
    <button type="button" class:on={active.strike} title="Strike" onclick={() => cmd((e) => e.chain().toggleStrike().run())}><s>S</s></button>
    <span class="be-sep"></span>
    <button type="button" class:on={active.h1} title="Heading 1" onclick={() => cmd((e) => e.chain().toggleHeading({ level: 1 }).run())}>H1</button>
    <button type="button" class:on={active.h2} title="Heading 2" onclick={() => cmd((e) => e.chain().toggleHeading({ level: 2 }).run())}>H2</button>
    <span class="be-sep"></span>
    <button type="button" class:on={active.ul} title="Bulleted list" onclick={() => cmd((e) => e.chain().toggleBulletList().run())}>•</button>
    <button type="button" class:on={active.ol} title="Numbered list" onclick={() => cmd((e) => e.chain().toggleOrderedList().run())}>1.</button>
    <button type="button" class:on={active.task} title="To-do" onclick={() => cmd((e) => e.chain().toggleTaskList().run())}>☑</button>
    <button type="button" class:on={active.code} title="Code block" onclick={() => cmd((e) => e.chain().toggleCodeBlock().run())}>{`</>`}</button>
    <span class="be-sep"></span>
    <button type="button" title="Insert image (also Ctrl+V to paste)" onclick={pickImage}>🖼</button>
  </div>
  <div class="be-host" bind:this={host}></div>
  {#if slashOpen && filteredSlash.length}
    <div class="be-slash" style="top: {slashPos.top}px; left: {slashPos.left}px;">
      {#each filteredSlash as it, i (it.label)}
        <button
          type="button"
          class="be-slash-item"
          class:sel={i === slashIndex}
          onmousedown={(e) => {
            e.preventDefault();
            runSlash(slashItems.indexOf(it));
          }}
        >
          <span class="be-slash-hint">{it.hint}</span>
          <span>{it.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .be {
    position: relative;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    background: var(--arc-surface);
    overflow: hidden;
  }
  .be-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    padding: 6px 8px;
    background: var(--arc-surface-2, #f7f8fa);
    border-bottom: 1px solid var(--arc-border);
  }
  .be-toolbar button {
    min-width: 28px;
    height: 26px;
    padding: 0 6px;
    border: 1px solid transparent;
    background: transparent;
    border-radius: 6px;
    font: inherit;
    font-size: 12px;
    color: var(--arc-text-soft);
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .be-toolbar button:hover {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
  }
  .be-toolbar button.on {
    background: var(--arc-primary);
    color: #fff;
    border-color: var(--arc-primary);
  }
  .be-sep {
    width: 1px;
    height: 18px;
    background: var(--arc-border);
    margin: 0 4px;
  }

  .be-host {
    min-height: 220px;
    max-height: 50vh;
    overflow-y: auto;
    padding: 12px 14px;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--arc-text);
  }
  .be-host :global(.ProseMirror) {
    outline: none;
    min-height: 200px;
  }
  .be-host :global(.ProseMirror p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    color: var(--arc-text-faint);
    pointer-events: none;
    height: 0;
  }
  .be-host :global(h1) { font-size: 22px; font-weight: 700; margin: 14px 0 6px; }
  .be-host :global(h2) { font-size: 18px; font-weight: 700; margin: 12px 0 6px; }
  .be-host :global(h3) { font-size: 15px; font-weight: 600; margin: 10px 0 4px; }
  .be-host :global(ul), .be-host :global(ol) { padding-left: 22px; margin: 6px 0; }
  .be-host :global(blockquote) {
    border-left: 3px solid var(--arc-primary);
    padding: 2px 10px;
    color: var(--arc-text-soft);
    background: var(--arc-primary-tint);
    border-radius: 0 6px 6px 0;
    margin: 8px 0;
  }
  .be-host :global(code) {
    background: var(--arc-surface-2, #f7f8fa);
    border: 1px solid var(--arc-border);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: var(--arc-mono, monospace);
    font-size: 12px;
  }
  .be-host :global(pre) {
    background: #0f172a;
    color: #e2e8f0;
    padding: 12px 14px;
    border-radius: 8px;
    overflow-x: auto;
    font-family: var(--arc-mono, monospace);
    font-size: 12.5px;
    margin: 8px 0;
  }
  .be-host :global(pre code) {
    background: transparent;
    border: none;
    color: inherit;
    padding: 0;
  }
  .be-host :global(hr) {
    border: none;
    border-top: 1px solid var(--arc-border);
    margin: 14px 0;
  }
  .be-host :global(ul[data-type="taskList"]) {
    list-style: none;
    padding-left: 4px;
  }
  .be-host :global(ul[data-type="taskList"] li) {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .be-host :global(ul[data-type="taskList"] li > label) {
    margin-top: 4px;
  }
  .be-host :global(ul[data-type="taskList"] li > div) {
    flex: 1;
  }

  .be-slash {
    position: absolute;
    z-index: 60;
    min-width: 200px;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    box-shadow: var(--arc-shadow-lg, 0 10px 30px rgba(0, 0, 0, 0.12));
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .be-slash-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    background: transparent;
    border-radius: 6px;
    text-align: left;
    font: inherit;
    font-size: 12.5px;
    color: var(--arc-text);
    cursor: pointer;
  }
  .be-slash-item:hover,
  .be-slash-item.sel {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
  }
  .be-slash-hint {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    font-size: 11px;
    font-weight: 600;
    background: var(--arc-surface-2, #f7f8fa);
    border: 1px solid var(--arc-border);
    border-radius: 5px;
    color: var(--arc-text-soft);
  }
</style>
