<script lang="ts">
  // Chrome-style tab strip (Fix 97). Launcher (Projects) is ALWAYS fixed +
  // drag-and-drop reorderable project tabs + a "+" new-project button.
  //
  // Dragging = pointer-event based (SortableJS approach). We use pointer instead
  // of HTML5 DnD because DnD + DOM reorder is fragile in Tauri/WebView2.
  // Mechanics: when a drag starts, all tab geometries are measured; the dragged
  // tab follows the cursor via translateX, the others shift by ±width to open a
  // gap (smooth via CSS transition). On drop, the new order is reported to the parent.
  import Icon from "$lib/icons/Icon.svelte";

  interface Tab {
    id: string;
    name: string;
    port: number;
  }

  interface Props {
    tabs: Tab[];
    activeTab: string;
    launcherDot: "busy" | "unread" | "error" | null;
    tabActivity: Map<string, "busy" | "unread">;
    busy: boolean;
    openingProjectId: string | null;
    openingProjectName: string;
    onSelectTab: (id: string) => void;
    onCloseTab: (id: string) => void;
    onReorder: (orderedIds: string[]) => void;
    onNewProject: () => void;
  }
  let {
    tabs,
    activeTab,
    launcherDot,
    tabActivity,
    busy,
    openingProjectId,
    openingProjectName,
    onSelectTab,
    onCloseTab,
    onReorder,
    onNewProject,
  }: Props = $props();

  // --- Pointer-based drag state ---
  let tabEls: Record<string, HTMLButtonElement | undefined> = {};
  // While dragging: which tab, live dx, measured width, original+target index.
  let drag = $state<{
    id: string;
    dx: number;
    width: number;
    originIndex: number;
    targetIndex: number;
  } | null>(null);
  // click suppress: if a real drag happened, the following click should not trigger selectTab.
  let didDrag = false;

  function startTabDrag(e: PointerEvent, id: string) {
    if (e.button !== 0) return; // left button only
    // Do not start from the close (x) button
    if ((e.target as HTMLElement)?.closest(".tab-x")) return;
    const startX = e.clientX;
    let started = false;
    let measured: { id: string; center: number }[] = [];

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!started) {
        if (Math.abs(dx) < 4) return; // threshold: separate a click from a drag
        started = true;
        didDrag = true;
        const originIndex = tabs.findIndex((t) => t.id === id);
        if (originIndex < 0) return;
        measured = tabs.map((t) => {
          const r = tabEls[t.id]?.getBoundingClientRect();
          return { id: t.id, center: r ? r.left + r.width / 2 : 0 };
        });
        const w = tabEls[id]?.getBoundingClientRect().width ?? 0;
        drag = { id, dx: 0, width: w, originIndex, targetIndex: originIndex };
      }
      if (!drag) return;
      const projectedCenter = measured[drag.originIndex].center + dx;
      // target index = how many tab centers are to its left (excluding the dragged one)
      let target = 0;
      for (let i = 0; i < measured.length; i++) {
        if (i === drag.originIndex) continue;
        if (measured[i].center < projectedCenter) target++;
      }
      target = Math.max(0, Math.min(tabs.length - 1, target));
      drag = { ...drag, dx, targetIndex: target };
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (drag && started && drag.targetIndex !== drag.originIndex) {
        const arr = tabs.map((t) => t.id);
        const [m] = arr.splice(drag.originIndex, 1);
        arr.splice(drag.targetIndex, 0, m);
        onReorder(arr);
      }
      drag = null;
      // the click event arrives after onUp; reset on the next tick
      setTimeout(() => (didDrag = false), 0);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  // A tab's live horizontal shift (px). The dragged tab follows the cursor;
  // the others shift by ±width to open a gap.
  function tabShift(id: string, index: number): number {
    if (!drag) return 0;
    if (id === drag.id) return drag.dx;
    const { originIndex: od, targetIndex: tg, width: w } = drag;
    if (od < tg && index > od && index <= tg) return -w;
    if (od > tg && index >= tg && index < od) return w;
    return 0;
  }
</script>

<nav class="tabstrip">
  <button
    class="tab tab-launcher"
    class:on={activeTab === "launcher"}
    title="Projects (Ctrl+1)"
    onclick={() => onSelectTab("launcher")}
  >
    <span
      class="tab-dot"
      class:tab-dot-busy={launcherDot === "busy"}
      class:tab-dot-unread={launcherDot === "unread"}
      class:tab-dot-error={launcherDot === "error"}
    ></span>
    <span class="tab-name">Projects</span>
  </button>
  {#each tabs as t, i (t.id)}
    <button
      bind:this={tabEls[t.id]}
      class="tab"
      class:on={activeTab === t.id}
      class:dragging={drag?.id === t.id}
      class:drag-active={drag !== null}
      style:transform={`translateX(${tabShift(t.id, i)}px)`}
      title={`${t.name}${i < 7 ? ` (Ctrl+${i + 2})` : ""}`}
      onpointerdown={(e) => startTabDrag(e, t.id)}
      onclick={() => {
        if (didDrag) return; // swallow the fake click after a drag
        onSelectTab(t.id);
      }}
      onauxclick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onCloseTab(t.id);
        }
      }}
    >
      <span
        class="tab-dot"
        class:tab-dot-busy={tabActivity.get(t.id) === "busy"}
        class:tab-dot-unread={tabActivity.get(t.id) === "unread"}
      ></span>
      <span class="tab-name">{t.name}</span>
      <span
        class="tab-x"
        role="button"
        tabindex="0"
        aria-label="Close tab (Ctrl+W)"
        title="Close (Ctrl+W)"
        onclick={(e) => {
          e.stopPropagation();
          onCloseTab(t.id);
        }}
        onkeydown={(e) => e.key === "Enter" && onCloseTab(t.id)}
      >
        <Icon name="x" size={12} stroke={2.4} />
      </span>
    </button>
  {/each}
  {#if openingProjectId && !tabs.find((t) => t.id === openingProjectId)}
    <button class="tab tab-loading" disabled>
      <span class="tab-dot tab-dot-spin"></span>
      <span class="tab-name">{openingProjectName}</span>
      <Icon name="loader" size={11} stroke={2} spin={true} />
    </button>
  {/if}
  <button
    class="tab-new"
    type="button"
    title="New project (Ctrl+T)"
    aria-label="New project"
    disabled={busy}
    onclick={onNewProject}
  >
    <Icon name="plus" size={14} stroke={2.2} />
  </button>
</nav>

<style>
  .tabstrip {
    flex-shrink: 0;
    display: flex;
    align-items: flex-end;
    gap: 1px;
    background: var(--arc-n200);
    border-bottom: 1px solid var(--arc-border);
    padding: 6px 8px 0 8px;
    overflow-x: auto;
    scrollbar-width: none;
    position: relative;
  }
  .tabstrip::-webkit-scrollbar { display: none; }

  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    border: none;
    background: transparent;
    color: var(--arc-text-soft);
    padding: 0 10px 0 12px;
    height: 32px;
    border-radius: 10px 10px 0 0;
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
    min-width: 110px;
    max-width: 220px;
    flex-shrink: 1;
    cursor: pointer;
    margin-bottom: -1px;
    user-select: none;
    touch-action: none;
    transition:
      background 0.15s var(--arc-ease),
      color 0.15s var(--arc-ease),
      transform 0.18s var(--arc-ease);
  }
  .tab:hover {
    background: var(--arc-n100);
    color: var(--arc-text);
  }
  .tab.on {
    background: var(--arc-surface);
    color: var(--arc-text);
    font-weight: 600;
    box-shadow:
      inset 0 1px 0 var(--arc-border),
      inset 1px 0 0 var(--arc-border),
      inset -1px 0 0 var(--arc-border);
    z-index: 2;
  }
  /* While dragging: the other tabs flow via transform to open a gap
     (transition: transform defined above). The dragged tab must follow the
     cursor INSTANTLY — disable its transform transition. */
  .tab.dragging {
    transition:
      background 0.15s var(--arc-ease),
      color 0.15s var(--arc-ease);
    background: var(--arc-surface);
    color: var(--arc-text);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
    opacity: 0.92;
    z-index: 10;
    cursor: grabbing;
  }
  /* Suppress the hover background during a drag — only the shift should show. */
  .tab.drag-active:not(.dragging):hover {
    background: transparent;
    color: var(--arc-text-soft);
  }
  .tab.drag-active.on:not(.dragging):hover {
    background: var(--arc-surface);
    color: var(--arc-text);
  }
  .tab.tab-launcher {
    min-width: auto;
    padding: 0 14px;
  }
  .tab-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--arc-n300);
    flex-shrink: 0;
    transition: background 0.15s var(--arc-ease), transform 0.15s var(--arc-ease);
  }
  /* The active tab is already clear with a white background + bold text. Its dot
     is neutral (gray) — green is reserved ONLY for the "unread reply" signal. */
  .tab.on .tab-dot {
    background: var(--arc-text-soft);
    transform: scale(1.1);
  }
  .tab-dot.tab-dot-error {
    background: var(--arc-danger);
    transform: scale(1.3);
    animation: tab-dot-pulse 1.2s ease-in-out infinite;
  }
  /* Running → orange, blinking. */
  .tab-dot.tab-dot-busy {
    background: #f59e0b;
    transform: scale(1.3);
    animation: tab-dot-pulse 1.2s ease-in-out infinite;
  }
  /* A reply arrived / work finished and the user has not seen it: GREEN, BLINKING. */
  .tab-dot.tab-dot-unread {
    background: #16a34a;
    transform: scale(1.3);
    animation: tab-dot-pulse 1.2s ease-in-out infinite;
  }
  @keyframes tab-dot-pulse {
    0%, 100% { opacity: 1; transform: scale(1.3); }
    50% { opacity: 0.4; transform: scale(1.0); }
  }
  .tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }
  .tab-x {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    color: var(--arc-text-faint);
    flex-shrink: 0;
    opacity: 0;
    transition:
      background 0.12s var(--arc-ease),
      color 0.12s var(--arc-ease),
      opacity 0.12s var(--arc-ease);
  }
  .tab:hover .tab-x,
  .tab.on .tab-x {
    opacity: 1;
  }
  .tab-x:hover {
    background: var(--arc-n200);
    color: var(--arc-text);
  }
  .tab.on .tab-x:hover {
    background: var(--arc-n100);
  }

  .tab-loading {
    opacity: 0.85;
    cursor: progress;
    color: var(--arc-primary);
    background: var(--arc-primary-tint);
    animation: tab-loading-pulse 1.6s var(--arc-ease) infinite;
  }
  .tab-dot-spin {
    background: var(--arc-primary) !important;
    animation: tab-dot-rotate 1.2s linear infinite;
  }
  @keyframes tab-loading-pulse {
    0%, 100% { opacity: 0.85; }
    50% { opacity: 1; }
  }
  @keyframes tab-dot-rotate {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.5); opacity: 0.5; }
  }

  .tab-new {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin: 0 0 4px 4px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--arc-text-soft);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.12s var(--arc-ease), color 0.12s var(--arc-ease);
  }
  .tab-new:hover:not(:disabled) {
    background: var(--arc-n100);
    color: var(--arc-text);
  }
  .tab-new:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
