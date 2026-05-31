<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import type { ProjectSession } from "$lib/store.svelte";
  import { fmtTime as fmtTimeTr } from "$lib/time";

  interface Props {
    session: ProjectSession;
    // Short agent name. If empty, the header only shows "SESSIONS".
    agentLabel?: string;
    // Makes the splitter localStorage key per-instance unique (when the same
    // component is opened for different agents, splitter positions do not clash).
    storageKey?: string;
  }
  const {
    session,
    agentLabel = "",
    storageKey = "default",
  }: Props = $props();

  // --- Splitter state (sessions bottom %, between chiefs top %) ---
  // Default 60/40 sessions/between. Persisted to localStorage.
  const splitKey = $derived(`arc:rail:split:${storageKey}`);
  let splitPct = $state<number>(60);
  let rootEl: HTMLElement | undefined = $state();
  let dragging = $state(false);

  onMount(() => {
    try {
      const raw = localStorage.getItem(splitKey);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 25 && n <= 85) splitPct = n;
      }
    } catch { /* ignore */ }
  });

  function startDrag(e: PointerEvent) {
    e.preventDefault();
    dragging = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDrag(e: PointerEvent) {
    if (!dragging || !rootEl) return;
    const rect = rootEl.getBoundingClientRect();
    // The header (34px) is above the splitter — compute the real list area.
    const headerOffset = 34;
    const usable = rect.height - headerOffset;
    const rel = e.clientY - rect.top - headerOffset;
    let pct = (rel / usable) * 100;
    if (pct < 25) pct = 25;
    if (pct > 85) pct = 85;
    splitPct = pct;
  }
  function endDrag(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    try { localStorage.setItem(splitKey, String(Math.round(splitPct))); } catch { /* ignore */ }
  }

  // --- Sessions: inline rename / delete flow ---
  let renameId = $state<string | null>(null);
  let renameVal = $state("");
  function basla(id: string, mevcut: string) {
    renameId = id;
    renameVal = mevcut;
  }
  function bitir() {
    if (renameId && renameVal.trim()) session.sessionRename(renameId, renameVal.trim());
    renameId = null;
    renameVal = "";
  }
  function iptal() {
    renameId = null;
    renameVal = "";
  }
  function focusInput(el: HTMLInputElement) {
    requestAnimationFrame(() => { el.focus(); el.select(); });
  }

  // Two-click delete — the Tauri ACL native confirm does not work.
  let pendingDeleteId = $state<string | null>(null);
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  function sil(id: string, e: Event) {
    e.stopPropagation();
    if (pendingDeleteId === id) {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingDeleteId = null;
      pendingTimer = null;
      session.sessionDelete(id);
      return;
    }
    pendingDeleteId = id;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingDeleteId = null;
      pendingTimer = null;
    }, 3000);
  }

  // Primary cannot be deleted — if the user tries, give subtle shake feedback.
  let shakeId = $state<string | null>(null);
  function shakeFor(id: string) {
    shakeId = id;
    setTimeout(() => { if (shakeId === id) shakeId = null; }, 350);
  }

  // --- Keyboard shortcuts ---
  // j/k navigation, Ctrl+N new session, F2 rename, Delete to remove.
  // Only while the rail is focused — to avoid interfering with text inputs.
  function onKey(e: KeyboardEvent) {
    if (renameId) return; // in rename mode the input handles its own events
    const list = session.sessions;
    if (!list.length) return;
    const curIdx = list.findIndex((s) => s.id === session.activeSessionId);
    const safe = curIdx < 0 ? 0 : curIdx;
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = list[Math.min(safe + 1, list.length - 1)];
      if (next) session.sessionSelect(next.id);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = list[Math.max(safe - 1, 0)];
      if (prev) session.sessionSelect(prev.id);
    } else if ((e.key === "n" || e.key === "N") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      session.sessionCreate();
    } else if (e.key === "F2") {
      const cur = list[safe];
      if (cur) { e.preventDefault(); basla(cur.id, cur.name); }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      const cur = list[safe];
      if (!cur) return;
      if (cur.role === "primary") { shakeFor(cur.id); return; }
      e.preventDefault();
      sil(cur.id, e);
    }
  }

  // --- Between Chiefs feed ---
  const crossEvents = $derived(
    session.feed.filter((e) => e.type === "sefler_arasi"),
  );

  function sessionLabel(ts: number): string {
    if (!ts) return "Not spoken yet";
    const diff = Date.now() - ts;
    const dk = Math.floor(diff / 60000);
    if (dk < 1) return "Just now";
    if (dk < 60) return `${dk}m ago`;
    const sa = Math.floor(dk / 60);
    if (sa < 24) return `${sa}h ago`;
    return fmtTimeTr(ts);
  }

  function fmtTok(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
  }
</script>

<section
  class="rail"
  bind:this={rootEl}
  aria-label="Session panel"
  tabindex="0"
  onkeydown={onKey}
>
  <!-- top: SESSIONS title + agent badge + plus -->
  <header class="rail-h">
    <div class="rail-h-id">
      <span class="rail-h-title">Sessions</span>
      {#if agentLabel}
        <span class="rail-h-dot"></span>
        <span class="rail-h-agent">{agentLabel}</span>
      {/if}
    </div>
    <button
      class="rail-h-add"
      title="New session (Ctrl+N)"
      aria-label="New session"
      onclick={() => session.sessionCreate()}
    >
      <Icon name="plus" size={13} stroke={2.6} />
    </button>
  </header>

  <!-- top panel: sessions list -->
  <div class="rail-sessions" role="listbox" aria-label="Sessions" style="flex-basis: {splitPct}%">
    {#each session.sessions as s (s.id)}
      {@const aktif = s.id === session.activeSessionId}
      {@const busy = session.runningSessions.includes(s.id)}
      {@const renameMode = renameId === s.id}
      {@const silinebilir = s.role === "secondary"}
      <div
        class="card"
        class:aktif
        class:shake={shakeId === s.id}
        role="option"
        tabindex="-1"
        aria-selected={aktif}
        onclick={() => !renameMode && session.sessionSelect(s.id)}
        onkeydown={(e) => {
          if (renameMode) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            session.sessionSelect(s.id);
          }
        }}
        ondblclick={(e) => { e.stopPropagation(); basla(s.id, s.name); }}
      >
        <span class="dot" class:on={aktif && !busy} class:busy class:activity={!aktif && !busy && s.hasActivity}></span>
        <div class="card-body">
          {#if renameMode}
            <input
              class="rename"
              bind:value={renameVal}
              use:focusInput
              onkeydown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); bitir(); }
                else if (e.key === "Escape") iptal();
              }}
              onblur={bitir}
            />
          {:else}
            <span class="name">{s.name}</span>
            <span class="time">{sessionLabel(s.lastTurnTs)}</span>
          {/if}
        </div>
        {#if s.role === "primary" && !renameMode}
          <span class="role-badge">Primary</span>
        {/if}
        {#if !renameMode}
          <div class="row-actions">
            <button
              class="act"
              title="Rename (F2)"
              aria-label="Rename"
              onclick={(e) => { e.stopPropagation(); basla(s.id, s.name); }}
            >
              <Icon name="edit" size={11} stroke={2.4} />
            </button>
            {#if silinebilir}
              <button
                class="act del"
                class:pending={pendingDeleteId === s.id}
                title={pendingDeleteId === s.id ? "Click again = DELETE" : "Delete (Del)"}
                aria-label="Delete session"
                onclick={(e) => sil(s.id, e)}
              >
                <Icon name={pendingDeleteId === s.id ? "check" : "x"} size={11} stroke={2.4} />
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- splitter -->
  <div
    class="splitter"
    class:dragging
    role="separator"
    aria-orientation="horizontal"
    aria-label="Panel size"
    onpointerdown={startDrag}
    onpointermove={onDrag}
    onpointerup={endDrag}
    onpointercancel={endDrag}
  ><span class="splitter-grip"></span></div>

  <!-- bottom panel: between chiefs feed -->
  <div class="rail-between" style="flex-basis: {100 - splitPct}%">
    <div class="between-h">
      <Icon name="share" size={11} stroke={2.2} />
      <span class="between-h-label">Between chiefs</span>
      {#if crossEvents.length}
        <span class="between-h-count">{crossEvents.length}</span>
      {/if}
    </div>
    {#if crossEvents.length === 0}
      <div class="between-empty">
        <Icon name="share" size={18} stroke={1.6} />
        <span>No inter-agent messages yet</span>
      </div>
    {:else}
      <div class="between-list">
        {#each crossEvents as ev (ev.uid)}
          {@const c = ev.payload.cost as { usd?: number; in?: number; out?: number; cacheRead?: number } | undefined}
          <div class="bcard" class:err={ev.payload.isError}>
            <div class="bcard-route">
              <!-- Fix 131: show the real sending chief. It used to be hard-coded
                   to "Mimar"; now the emitting orchestrator's projectName
                   (kaynak) arrives. If old feed events have no kaynak, use Mimar. -->
              <span class="bcard-from">{ev.payload.kaynak ?? "Mimar"}</span>
              <Icon name="chevronRight" size={9} stroke={2.4} />
              <span class="bcard-to">{ev.payload.hedef}</span>
              <span class="bcard-spacer"></span>
              {#if ev.payload.isError}
                <span class="bcard-tag err">error</span>
              {:else if ev.payload.cevap}
                <span class="bcard-tag ok">reply</span>
              {/if}
            </div>
            <div class="bcard-msg">{ev.payload.mesaj}</div>
            {#if ev.payload.cevap}
              <div class="bcard-reply">{ev.payload.cevap}</div>
            {/if}
            {#if c && (c.usd || c.in)}
              <div class="bcard-cost">
                {#if c.usd}${c.usd.toFixed(4)} ·{/if}
                {#if c.in}{fmtTok(c.in)} in{/if}
                {#if c.out} · {fmtTok(c.out)} out{/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .rail {
    --rail-card-radius: 6px;
    --rail-card-height: 40px;
    --rail-dot-size: 8px;
    --rail-header-h: 34px;
    --rail-splitter-h: 4px;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--arc-surface);
    outline: none;
    overflow: hidden;
  }
  .rail:focus-visible {
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--arc-primary) 60%, transparent);
  }

  /* ====== HEADER ====== */
  .rail-h {
    flex-shrink: 0;
    height: var(--rail-header-h);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    border-bottom: 1px solid var(--arc-border);
    background: var(--arc-surface);
  }
  .rail-h-id {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .rail-h-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--arc-text-faint);
  }
  .rail-h-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--arc-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--arc-primary) 18%, transparent);
    flex-shrink: 0;
  }
  .rail-h-agent {
    font-size: 11px;
    font-weight: 600;
    color: var(--arc-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 130px;
  }
  .rail-h-add {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--arc-primary) 22%, transparent);
    background: color-mix(in srgb, var(--arc-primary) 8%, transparent);
    color: var(--arc-primary);
    cursor: pointer;
    transition: background 0.14s, color 0.14s, transform 0.12s;
  }
  .rail-h-add:hover {
    background: var(--arc-primary);
    color: #fff;
    transform: translateY(-1px);
  }
  .rail-h-add:active { transform: translateY(0); }
  .rail-h-add:focus-visible {
    outline: 2px solid var(--arc-primary);
    outline-offset: 1px;
  }

  /* ====== SESSIONS LIST ====== */
  .rail-sessions {
    flex: 1 1 60%;
    min-height: 120px;
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .card {
    position: relative;
    height: var(--rail-card-height);
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 12px;
    border-radius: var(--rail-card-radius);
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: background 0.13s ease, border-color 0.13s ease;
    text-align: left;
  }
  .card:hover { background: var(--arc-surface-hover, color-mix(in srgb, var(--arc-primary) 5%, transparent)); }
  .card.aktif {
    background: color-mix(in srgb, var(--arc-primary) 12%, transparent);
    border-left: 2px solid var(--arc-primary);
    padding-left: 10px;
  }
  .card:focus-visible {
    outline: 2px solid var(--arc-primary);
    outline-offset: 1px;
  }
  .card.shake { animation: rail-shake 0.32s var(--arc-ease); }
  @keyframes rail-shake {
    0%, 100% { transform: translateX(0); }
    25%      { transform: translateX(-3px); }
    50%      { transform: translateX(3px); }
    75%      { transform: translateX(-2px); }
  }

  .dot {
    width: var(--rail-dot-size);
    height: var(--rail-dot-size);
    border-radius: 50%;
    background: var(--arc-border);
    flex-shrink: 0;
    transition: background 0.2s, box-shadow 0.2s, transform 0.15s;
  }
  /* Active but idle: neutral gray (being active is already clear from the card highlight).
     Green is ONLY for "unread activity". */
  .dot.on {
    background: var(--arc-text-soft);
    transform: scale(1.1);
  }
  /* Running → orange, blinking. */
  .dot.busy {
    background: #f59e0b;
    box-shadow: 0 0 0 3px color-mix(in srgb, #f59e0b 22%, transparent);
    animation: rail-pulse 1s ease-in-out infinite;
  }
  /* Finished & unseen → green, blinking. */
  .dot.activity {
    background: #16a34a;
    box-shadow: 0 0 0 3px color-mix(in srgb, #16a34a 22%, transparent);
    animation: rail-pulse 1s ease-in-out infinite;
  }
  @keyframes rail-pulse {
    0%, 100% { transform: scale(1.0); opacity: 1; }
    50%      { transform: scale(1.4); opacity: 0.45; }
  }

  .card-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .name {
    font-size: 13px;
    font-weight: 500;
    color: var(--arc-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.15;
  }
  .time {
    font-size: 11px;
    font-weight: 400;
    color: var(--arc-text-faint);
    opacity: 0.6;
    line-height: 1.1;
  }
  .card.aktif .time { opacity: 0.85; }

  .role-badge {
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--arc-primary);
    border: 1px solid color-mix(in srgb, var(--arc-primary) 35%, transparent);
    border-radius: 999px;
    padding: 1px 6px;
    opacity: 0.55;
    flex-shrink: 0;
    transition: opacity 0.14s;
  }
  .card.aktif .role-badge { opacity: 0.95; }

  .row-actions {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    gap: 3px;
    opacity: 0;
    transition: opacity 0.13s;
    background: linear-gradient(90deg, transparent 0%, var(--arc-surface) 25%);
    padding-left: 14px;
    border-radius: 0 var(--rail-card-radius) var(--rail-card-radius) 0;
  }
  .card:hover .row-actions { opacity: 1; }
  .card.aktif .row-actions {
    background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--arc-primary) 12%, var(--arc-surface)) 25%);
  }
  .act {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--arc-text-faint);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .act:hover {
    background: color-mix(in srgb, var(--arc-primary) 12%, transparent);
    color: var(--arc-primary);
  }
  .act.del:hover {
    background: color-mix(in srgb, var(--arc-danger) 12%, transparent);
    color: var(--arc-danger);
  }
  .act.del.pending {
    background: var(--arc-danger);
    color: #fff;
    animation: rail-del-pulse 0.85s ease-in-out infinite;
  }
  @keyframes rail-del-pulse {
    50% { transform: scale(1.15); }
  }

  .rename {
    width: 100%;
    box-sizing: border-box;
    padding: 3px 6px;
    border: 1px solid var(--arc-primary);
    border-radius: 4px;
    background: var(--arc-surface);
    font-size: 13px;
    font-family: inherit;
    color: var(--arc-text);
    outline: none;
  }

  /* ====== SPLITTER ====== */
  .splitter {
    flex-shrink: 0;
    height: var(--rail-splitter-h);
    position: relative;
    background: transparent;
    cursor: row-resize;
    touch-action: none;
    border-top: 1px solid var(--arc-border);
    border-bottom: 1px solid var(--arc-border);
    transition: background 0.15s;
  }
  .splitter:hover,
  .splitter.dragging {
    background: color-mix(in srgb, var(--arc-primary) 18%, transparent);
  }
  .splitter-grip {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 32px;
    height: 2px;
    border-radius: 999px;
    background: var(--arc-border);
    transition: background 0.15s;
  }
  .splitter:hover .splitter-grip,
  .splitter.dragging .splitter-grip {
    background: var(--arc-primary);
  }

  /* ====== BETWEEN CHIEFS ====== */
  .rail-between {
    flex: 1 1 40%;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .between-h {
    flex-shrink: 0;
    height: 28px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 12px;
    color: var(--arc-text-faint);
    background: var(--arc-surface);
    border-bottom: 1px solid var(--arc-border);
  }
  .between-h-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    flex: 1;
  }
  .between-h-count {
    font-size: 10px;
    font-weight: 700;
    background: color-mix(in srgb, var(--arc-primary) 12%, transparent);
    color: var(--arc-primary);
    border-radius: 999px;
    padding: 1px 7px;
    font-variant-numeric: tabular-nums;
  }

  .between-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: var(--arc-text-faint);
    opacity: 0.45;
    padding: 12px;
    text-align: center;
    font-size: 11px;
  }

  .between-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .bcard {
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid var(--arc-border);
    background: var(--arc-surface);
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: border-color 0.14s;
  }
  .bcard:hover { border-color: color-mix(in srgb, var(--arc-primary) 38%, var(--arc-border)); }
  .bcard.err {
    border-left: 2px solid var(--arc-danger);
    background: color-mix(in srgb, var(--arc-danger) 4%, var(--arc-surface));
  }

  .bcard-route {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--arc-text-faint);
    white-space: nowrap;
    overflow: hidden;
  }
  .bcard-from { opacity: 0.7; }
  .bcard-to { color: var(--arc-primary); }
  .bcard-spacer { flex: 1; }
  .bcard-tag {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .bcard-tag.ok {
    background: color-mix(in srgb, #16a34a 12%, transparent);
    color: #15803d;
  }
  .bcard-tag.err {
    background: color-mix(in srgb, var(--arc-danger) 12%, transparent);
    color: var(--arc-danger);
  }

  .bcard-msg {
    font-size: 12px;
    color: var(--arc-text);
    line-height: 1.4;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .bcard-reply {
    font-size: 12px;
    font-style: italic;
    color: var(--arc-text-soft);
    background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-surface));
    border-radius: 6px;
    padding: 6px 8px;
    line-height: 1.4;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .bcard-cost {
    font-size: 10px;
    font-family: var(--arc-mono);
    color: var(--arc-text-faint);
    opacity: 0.55;
    font-variant-numeric: tabular-nums;
  }
</style>
