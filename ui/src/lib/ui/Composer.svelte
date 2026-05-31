<script lang="ts">
  import Icon from "$lib/icons/Icon.svelte";
  import Lightbox from "./Lightbox.svelte";
  import type { Attachment } from "$lib/store.svelte";

  let lightboxSrc = $state<string | null>(null);

  function attachmentSrc(a: Attachment): string {
    return `data:${a.mediaType ?? "image/png"};base64,${a.veri}`;
  }

  let {
    draft = $bindable(""),
    attachments = [],
    disabled = false,
    placeholder = "Write a message…",
    speechAvailable = false,
    recording = false,
    running = false,
    activityLabel = "",
    onSend,
    onStop,
    onPause,
    onFiles,
    onRemoveAttachment,
    onToggleMic,
    onPaste,
  }: {
    draft?: string;
    attachments?: Attachment[];
    disabled?: boolean;
    placeholder?: string;
    speechAvailable?: boolean;
    recording?: boolean;
    running?: boolean;
    activityLabel?: string;
    onSend: () => void;
    // F7: onStop = stop (one-shot interrupt; queue continues). onPause =
    // pause (pause the queue). The Composer routes the user's choice to two
    // different callbacks.
    onStop?: () => void;
    onPause?: () => void;
    onFiles: (e: Event) => void;
    onRemoveAttachment: (i: number) => void;
    onToggleMic: () => void;
    onPaste?: (files: File[]) => void;
  } = $props();

  let fileInput: HTMLInputElement | null = $state(null);
  let textEl: HTMLTextAreaElement | null = $state(null);
  // F7: stop kebab menu — the user reaches the "Pause" option through this menu.
  // Single-click stop button = stop (one-shot). Kebab → Pause = pause the queue.
  let stopMenuOpen = $state(false);
  let stopMenuRef: HTMLDivElement | null = $state(null);

  function toggleStopMenu(e: MouseEvent) {
    e.stopPropagation();
    stopMenuOpen = !stopMenuOpen;
  }

  function pickDurdur() {
    stopMenuOpen = false;
    onStop?.();
  }

  function pickDuraklat() {
    stopMenuOpen = false;
    onPause?.();
  }

  // Close the menu on an outside click.
  $effect(() => {
    if (!stopMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!stopMenuRef) return;
      if (!stopMenuRef.contains(e.target as Node)) stopMenuOpen = false;
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  });

  // P1.17: sending a photo/file on its own is FORBIDDEN — at least 1 character
  // of text is required. The Send button is disabled on empty text (Enter also
  // blocks empty text — the guard above also catches it in `send()`).
  const canSend = $derived(!disabled && draft.trim() !== "");

  // Claude Code compatible slash menu — only opens if the textarea STARTS with '/'.
  // It does not open when you type / in the middle of a sentence.
  interface SlashCmd {
    key: string; // "/compact"
    desc: string;
  }
  const SLASH_CMDS: SlashCmd[] = [
    { key: "/compact", desc: "Compact chat memory" },
    { key: "/clear", desc: "Clear the chat view" },
    { key: "/plan", desc: "Toggle plan mode" },
    { key: "/model", desc: "Change model" },
    { key: "/help", desc: "Help" },
  ];
  // Open condition: draft starts with "/", no space/newline yet.
  // It does not open mid-sentence (because draft "hello /" does not start with "/").
  const slashOpen = $derived(
    draft.startsWith("/") && !draft.includes("\n") && !draft.includes(" "),
  );
  const slashFiltered = $derived(
    slashOpen ? SLASH_CMDS.filter((c) => c.key.startsWith(draft)) : [],
  );
  let slashIdx = $state(0);
  $effect(() => {
    void slashFiltered.length;
    if (slashIdx >= slashFiltered.length) slashIdx = 0;
  });

  function pickSlash(cmd: SlashCmd) {
    draft = cmd.key + " ";
    slashIdx = 0;
    setTimeout(() => textEl?.focus(), 0);
  }

  // Fix 106: on every keystroke autoGrow triggered a forced layout reflow via
  // `style.height = "auto"` + scrollHeight read. In a long chat (1000+ DOM nodes)
  // this took 200-500ms and froze the composer. Fix: batch it with rAF —
  // consecutive keystrokes collapse into a single layout cycle; also the reflow
  // is scoped to around the textarea instead of the whole window (contain: layout).
  let autoGrowQueued = false;
  function autoGrow() {
    if (!textEl) return;
    if (autoGrowQueued) return;
    autoGrowQueued = true;
    requestAnimationFrame(() => {
      autoGrowQueued = false;
      if (!textEl) return;
      textEl.style.height = "auto";
      const sh = textEl.scrollHeight;
      // In a hidden panel (display:none) scrollHeight is 0 — do not reset the
      // height; the CSS min-height keeps a single line.
      textEl.style.height = sh > 0 ? Math.min(sh, 168) + "px" : "";
    });
  }

  $effect(() => {
    void draft;
    autoGrow();
  });

  function onKey(e: KeyboardEvent) {
    if (slashOpen && slashFiltered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        slashIdx = (slashIdx + 1) % slashFiltered.length;
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        slashIdx = (slashIdx - 1 + slashFiltered.length) % slashFiltered.length;
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        pickSlash(slashFiltered[slashIdx]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Send even while running — the backend queues it and processes in order.
      if (canSend) onSend();
    }
  }

  function onPasteEvent(e: ClipboardEvent) {
    if (!onPaste) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      onPaste(files);
    }
  }
</script>

<div class="composer" class:focused-disabled={disabled}>
  {#if slashOpen && slashFiltered.length > 0}
    <div class="slash-menu">
      {#each slashFiltered as c, i (c.key)}
        <button
          class="slash-item"
          class:on={i === slashIdx}
          onmouseenter={() => (slashIdx = i)}
          onclick={() => pickSlash(c)}
        >
          <span class="slash-key">{c.key}</span>
          <span class="slash-desc">{c.desc}</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if attachments.length}
    <div class="attachments">
      {#each attachments as a, i (a.ad + i)}
        {#if a.tur === "resim"}
          <div class="thumb">
            <button
              class="thumb-img"
              title={a.ad}
              aria-label="Preview image"
              onclick={() => (lightboxSrc = attachmentSrc(a))}
            >
              <img src={attachmentSrc(a)} alt={a.ad} />
            </button>
            <button
              class="thumb-x"
              title="Remove"
              aria-label="Remove attachment"
              onclick={() => onRemoveAttachment(i)}
            >
              <Icon name="x" size={12} stroke={2.4} />
            </button>
          </div>
        {:else}
          <span class="chip">
            <Icon name="fileText" size={13} />
            <span class="chip-name">{a.ad}</span>
            <button
              class="chip-x"
              title="Remove"
              aria-label="Remove attachment"
              onclick={() => onRemoveAttachment(i)}
            >
              <Icon name="x" size={12} stroke={2.4} />
            </button>
          </span>
        {/if}
      {/each}
    </div>
  {/if}

  <div class="row">
    <input
      type="file"
      multiple
      accept="image/*,.txt,.md,.json,.js,.ts,.css,.html,.csv,.xml,.yml,.yaml,.py,.rs,.svelte,.log"
      bind:this={fileInput}
      onchange={onFiles}
      style="display:none"
    />
    <button
      class="act"
      title="Attach image / file"
      aria-label="Attach file"
      onclick={() => fileInput?.click()}
    >
      <Icon name="paperclip" size={17} />
    </button>

    <textarea
      bind:this={textEl}
      bind:value={draft}
      onkeydown={onKey}
      oninput={autoGrow}
      onpaste={onPasteEvent}
      {placeholder}
      rows="1"
    ></textarea>

    {#if speechAvailable}
      <button
        class="act"
        class:rec={recording}
        onclick={onToggleMic}
        title={recording ? "Stop listening (F3)" : "Voice message (F3)"}
        aria-label="Voice message"
      >
        <Icon name={recording ? "square" : "mic"} size={16} />
      </button>
    {/if}

    {#if running && onStop}
      <div class="stop-group" bind:this={stopMenuRef}>
        <button
          class="act stop-mini"
          onclick={pickDurdur}
          title="Stop — interrupt the current turn, keep the queue going"
          aria-label="Stop"
        >
          <Icon name="square" size={14} stroke={2.4} />
        </button>
        {#if onPause}
          <button
            class="act stop-caret"
            onclick={toggleStopMenu}
            title="More options"
            aria-label="Stop menu"
            aria-expanded={stopMenuOpen}
          >
            <Icon name="chevronDown" size={11} stroke={2.4} />
          </button>
          {#if stopMenuOpen}
            <div class="stop-menu" role="menu">
              <button class="stop-menu-item" role="menuitem" onclick={pickDurdur}>
                <span class="smi-title">Stop</span>
                <span class="smi-desc">Interrupt this turn, let the queue continue</span>
              </button>
              <button class="stop-menu-item" role="menuitem" onclick={pickDuraklat}>
                <span class="smi-title">Pause</span>
                <span class="smi-desc">Pause the queue, press "Resume" to continue</span>
              </button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
    <button
      class="send"
      onclick={onSend}
      disabled={!canSend}
      title={running ? "Queue (Enter)" : "Send (Enter)"}
      aria-label="Send"
    >
      <Icon name="send" size={16} stroke={2} />
    </button>
  </div>
</div>

<Lightbox src={lightboxSrc} onClose={() => (lightboxSrc = null)} />

<style>
  .composer {
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r);
    background: var(--arc-surface);
    box-shadow: var(--arc-shadow-sm);
    transition: border-color 0.15s var(--arc-ease), box-shadow 0.15s var(--arc-ease);
  }
  .composer:focus-within {
    border-color: var(--arc-primary);
    box-shadow: 0 0 0 3px var(--arc-primary-soft);
  }

  .attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 9px 10px 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 200px;
    font-size: 11px;
    font-weight: 500;
    background: var(--arc-primary-tint);
    border: 1px solid var(--arc-primary-soft);
    color: var(--arc-primary-strong);
    border-radius: var(--arc-r-sm);
    padding: 4px 5px 4px 8px;
  }
  .chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip-x {
    display: grid;
    place-items: center;
    border: none;
    background: transparent;
    color: var(--arc-primary-strong);
    border-radius: 4px;
    padding: 2px;
  }
  .chip-x:hover {
    background: var(--arc-primary-soft);
  }

  .thumb {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: var(--arc-r-sm);
    overflow: visible;
    background: transparent;
    /* A little breathing room on the top-right outer corner - the X button overflows outward. */
    margin: 6px 8px 0 2px;
  }
  .thumb-img {
    width: 100%;
    height: 100%;
    padding: 0;
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    overflow: hidden;
    background: var(--arc-surface);
    box-shadow: var(--arc-shadow-sm);
    cursor: zoom-in;
    line-height: 0;
    transition: box-shadow 0.15s var(--arc-ease);
  }
  .thumb-img:hover {
    box-shadow: var(--arc-shadow);
  }
  .thumb-img img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .thumb-x {
    position: absolute;
    top: -7px;
    right: -7px;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: 1.5px solid #ffffff;
    border-radius: var(--arc-r-pill);
    background: var(--arc-text, #0f1115);
    color: #ffffff;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(15, 17, 21, 0.25);
    opacity: 0;
    transform: scale(0.85);
    transition:
      opacity 0.15s var(--arc-ease),
      transform 0.15s var(--arc-ease),
      background 0.15s var(--arc-ease);
  }
  .thumb:hover .thumb-x,
  .thumb-x:focus-visible {
    opacity: 1;
    transform: scale(1);
  }
  .thumb-x:hover {
    background: var(--arc-danger, #dc2626);
  }

  .row {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    padding: 8px;
  }

  .act {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border: 1px solid transparent;
    border-radius: var(--arc-r-sm);
    background: transparent;
    color: var(--arc-text-faint);
    transition:
      background 0.15s var(--arc-ease),
      color 0.15s var(--arc-ease),
      border-color 0.15s var(--arc-ease);
  }
  .act:hover {
    background: var(--arc-n100);
    color: var(--arc-text);
  }
  .act.rec {
    background: var(--arc-danger);
    border-color: var(--arc-danger);
    color: #fff;
    animation: rec-pulse 1.2s var(--arc-ease) infinite;
  }
  @keyframes rec-pulse {
    50% {
      box-shadow: 0 0 0 5px rgba(220, 38, 38, 0.18);
    }
  }

  textarea {
    flex: 1;
    min-width: 0;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.5;
    color: var(--arc-text);
    padding: 9px 4px;
    min-height: 38px;
    max-height: 168px;
  }
  textarea::placeholder {
    color: var(--arc-text-faint);
  }

  .send {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border: none;
    border-radius: var(--arc-r-sm);
    background: var(--arc-primary);
    color: #fff;
    transition:
      background 0.15s var(--arc-ease),
      transform 0.15s var(--arc-ease),
      box-shadow 0.15s var(--arc-ease);
  }
  .send:hover:not(:disabled) {
    background: var(--arc-primary-hover);
    transform: translateY(-1px);
    box-shadow: var(--arc-shadow-teal);
  }
  .send:active:not(:disabled) {
    transform: scale(0.96);
  }
  .send:disabled {
    background: var(--arc-n300);
    cursor: not-allowed;
  }
  .act.stop-mini {
    color: var(--arc-danger, #dc2626);
    animation: stop-pulse-mini 1.4s var(--arc-ease) infinite;
  }
  .act.stop-mini:hover {
    color: #b91c1c;
    background: rgba(220, 38, 38, 0.08);
  }
  @keyframes stop-pulse-mini {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
  }

  /* F7: stop button + kebab group */
  .stop-group {
    position: relative;
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .act.stop-caret {
    width: 18px;
    color: var(--arc-text-faint);
    padding: 0;
  }
  .act.stop-caret:hover {
    color: var(--arc-text);
    background: var(--arc-n100);
  }
  .stop-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 0;
    min-width: 220px;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    box-shadow: var(--arc-shadow);
    padding: 4px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stop-menu-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    border: none;
    background: transparent;
    padding: 7px 10px;
    border-radius: var(--arc-r-sm);
    text-align: left;
    cursor: pointer;
    color: var(--arc-text);
    transition: background 0.1s;
  }
  .stop-menu-item:hover {
    background: var(--arc-primary-soft);
  }
  .smi-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--arc-text);
  }
  .smi-desc {
    font-size: 11px;
    color: var(--arc-text-soft);
  }

  /* Slash menu */
  .slash-menu {
    border-bottom: 1px solid var(--arc-border);
    background: var(--arc-surface-2);
    max-height: 260px;
    overflow-y: auto;
    padding: 5px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .slash-item {
    display: flex;
    align-items: baseline;
    gap: 10px;
    border: none;
    background: transparent;
    padding: 7px 10px;
    border-radius: var(--arc-r-sm);
    text-align: left;
    cursor: pointer;
    color: var(--arc-text);
    transition: background 0.1s;
  }
  .slash-item:hover,
  .slash-item.on {
    background: var(--arc-primary-soft);
  }
  .slash-key {
    font-family: var(--arc-mono);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--arc-primary-strong);
    min-width: 86px;
  }
  .slash-desc {
    font-size: 11.5px;
    color: var(--arc-text-soft);
  }
</style>
