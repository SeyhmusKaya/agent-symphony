<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { ProjectSession } from "$lib/store.svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import StatsBlock from "$lib/codegraph/StatsBlock.svelte";
  import SearchPanel from "$lib/codegraph/SearchPanel.svelte";
  import SymbolDetail from "$lib/codegraph/SymbolDetail.svelte";
  import type {
    Stats,
    CgSymbol,
    RelatedSymbol,
    ImportsData,
  } from "$lib/codegraph/helpers.js";

  interface Tab {
    id: string;
    name: string;
    port: number;
  }
  interface Props {
    session: ProjectSession;
    tabs?: Tab[];
  }
  let { session, tabs = [] }: Props = $props();

  // ───────────── Per-project sessions ─────────────────────────────
  const projectSessions = new Map<string, ProjectSession>();

  function getOrCreateSession(tab: Tab): ProjectSession {
    if (!projectSessions.has(tab.id)) {
      const s = new ProjectSession();
      s.connect(tab.port);
      projectSessions.set(tab.id, s);
    }
    return projectSessions.get(tab.id)!;
  }

  // ───────────── Scope selection ───────────────────────────────────
  let activeScope = $state<string>("architect");

  function activeSession(): ProjectSession {
    if (activeScope === "architect") return session;
    const tab = tabs.find((t) => t.id === activeScope);
    if (tab) return getOrCreateSession(tab);
    return session;
  }

  function activeScopeName(): string {
    if (activeScope === "architect") return "Architect";
    return tabs.find((t) => t.id === activeScope)?.name ?? "Unknown";
  }

  function changeScope(scope: string) {
    if (scope === activeScope) return;
    activeScope = scope;
    stats = null;
    statsErr = "";
    selected = null;
    results = [];
    search = "";
    kindFilter = "";
    rebuilding = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    void fetchStats();
  }

  // ───────────── State ─────────────────────────────────────────────
  let stats = $state<Stats | null>(null);
  let statsErr = $state("");
  let loading = $state(false);
  let rebuilding = $state(false);
  let search = $state("");
  let kindFilter = $state<string>("");
  let results = $state<CgSymbol[]>([]);
  let searching = $state(false);
  let selected = $state<CgSymbol | null>(null);
  let callers = $state<RelatedSymbol[]>([]);
  let callees = $state<RelatedSymbol[]>([]);
  let imports = $state<ImportsData | null>(null);
  let loadingDetails = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let detailEl: HTMLElement | null = $state(null);

  // ───────────── Queries ───────────────────────────────────────────
  async function fetchStats() {
    loading = true;
    statsErr = "";
    try {
      const s = activeSession();
      const res = (await s.codegraphQuery("stats")) as Stats;
      stats = res;
    } catch (e) {
      statsErr = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function runSearch() {
    const q = search.trim();
    if (!q && !kindFilter) { results = []; return; }
    searching = true;
    try {
      const s = activeSession();
      const res = (await s.codegraphQuery("search", {
        query: q,
        kind: kindFilter || undefined,
        limit: 50,
      })) as CgSymbol[];
      results = res;
    } catch {
      results = [];
    } finally {
      searching = false;
    }
  }

  async function selectSymbol(sym: CgSymbol) {
    selected = sym;
    callers = [];
    callees = [];
    imports = null;
    loadingDetails = true;
    await tick();
    detailEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    try {
      const s = activeSession();
      const [cs, ce, im] = await Promise.allSettled([
        s.codegraphQuery("callers", { symbol: sym.qname, depth: 2 }),
        s.codegraphQuery("callees", { symbol: sym.qname, depth: 2 }),
        s.codegraphQuery("imports", { path: sym.path }),
      ]);
      if (cs.status === "fulfilled") callers = cs.value as RelatedSymbol[];
      if (ce.status === "fulfilled") callees = ce.value as RelatedSymbol[];
      if (im.status === "fulfilled") imports = im.value as ImportsData;
    } finally {
      loadingDetails = false;
    }
  }

  async function triggerRebuild() {
    if (rebuilding) return;
    rebuilding = true;
    statsErr = "";
    try {
      const s = activeSession();
      await s.codegraphQuery("rebuild");
      setTimeout(fetchStats, 2000);
      if (!pollTimer) pollTimer = setInterval(fetchStats, 3000);
    } catch (e) {
      statsErr = `Rebuild failed: ${(e as Error).message}`;
      rebuilding = false;
    }
  }

  // Debounced search
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (searchTimer) clearTimeout(searchTimer);
    const q = search;
    searchTimer = setTimeout(() => {
      if (q.trim()) void runSearch();
      else results = [];
    }, 220);
  });

  // Stop polling once build is stable
  $effect(() => {
    if (stats && !stats.building && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      rebuilding = false;
    }
  });

  onMount(() => void fetchStats());
  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (searchTimer) clearTimeout(searchTimer);
    for (const [, s] of projectSessions) {
      try { (s as unknown as { ws?: { close(): void } }).ws?.close(); } catch { /* noop */ }
    }
  });

  // ───────────── Sub-component callbacks ──────────────────────────
  function onKindClick(kind: string) {
    kindFilter = kindFilter === kind ? "" : kind;
    if (kindFilter || search) void runSearch();
    else results = [];
  }

  function onSearchClear() {
    search = "";
    selected = null;
    if (kindFilter) void runSearch();
    else results = [];
  }

  function onKindClear() {
    kindFilter = "";
    if (search.trim()) void runSearch();
    else results = [];
  }
</script>

<div class="screen">
  <!-- ── Header ─────────────────────────────────────────────── -->
  <header class="screen-head">
    <div class="head-left">
      <span class="arc-caption">Analysis</span>
      <div class="head-title">
        Code Graph
        {#if stats?.projectRoot}
          <span class="head-path" title={stats.projectRoot}>{activeScopeName()}</span>
        {/if}
      </div>
    </div>
    <div class="head-right">
      {#if tabs.length > 0}
        <div class="scope-group">
          <button
            class="scope-btn"
            class:active={activeScope === "architect"}
            onclick={() => changeScope("architect")}
          >
            Architect
          </button>
          {#each tabs as t}
            <button
              class="scope-btn"
              class:active={activeScope === t.id}
              onclick={() => changeScope(t.id)}
            >
              {t.name}
            </button>
          {/each}
        </div>
      {/if}

      <div class="status-chip" class:building={stats?.building || rebuilding}>
        <span class="status-dot"></span>
        {#if stats?.building || rebuilding}
          Indexing…
        {:else if stats?.ready}
          Ready
        {:else if loading}
          Loading…
        {:else}
          Idle
        {/if}
      </div>

      <button
        class="arc-btn arc-btn-outline"
        onclick={triggerRebuild}
        disabled={rebuilding || stats?.building || loading}
      >
        <Icon name="refreshCw" size={13} stroke={2} />
        Re-index
      </button>
    </div>
  </header>

  <!-- ── Body ───────────────────────────────────────────────── -->
  <div class="cg-body">
    {#if statsErr}
      <div class="cg-error">
        <Icon name="alert" size={14} stroke={2} />
        {statsErr}
      </div>
    {/if}

    <StatsBlock {stats} {kindFilter} {onKindClick} />

    <div class="cg-explore">
      <SearchPanel
        {search}
        {kindFilter}
        {results}
        {searching}
        selectedQname={selected?.qname ?? null}
        onSearchInput={(v) => (search = v)}
        {onSearchClear}
        {onKindClear}
        onSelect={selectSymbol}
      />

      <div class="detail-pane" bind:this={detailEl}>
        <SymbolDetail {selected} {callers} {callees} {imports} {loadingDetails} />
      </div>
    </div>
  </div>
</div>

<style>
  /* ── Shell ──────────────────────────────────────────────────────── */
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--arc-bg);
  }

  /* ── Header ─────────────────────────────────────────────────────── */
  .screen-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 24px;
    background: var(--arc-surface);
    border-bottom: 1px solid var(--arc-border);
  }
  .head-left {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .head-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--arc-text);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .head-path {
    font-size: 12px;
    font-weight: 500;
    color: var(--arc-text-faint);
    font-family: var(--arc-mono);
    background: var(--arc-n100);
    padding: 2px 8px;
    border-radius: var(--arc-r-sm);
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  /* Scope selector */
  .scope-group {
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--arc-n100);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    padding: 3px;
  }
  .scope-btn {
    padding: 4px 12px;
    border: none;
    background: transparent;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 500;
    color: var(--arc-text-soft);
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .scope-btn:hover { color: var(--arc-text); }
  .scope-btn.active {
    background: var(--arc-surface);
    color: var(--arc-text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  /* Status chip */
  .status-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: var(--arc-n100);
    border-radius: var(--arc-r-sm);
    font-size: 11px;
    font-weight: 600;
    color: var(--arc-text-soft);
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--arc-text-faint);
  }
  .status-chip.building .status-dot {
    background: var(--arc-warning, #F59E0B);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* ── Body ───────────────────────────────────────────────────────── */
  .cg-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 24px 24px;
  }

  .cg-error {
    background: var(--arc-danger-soft, #DC262614);
    color: var(--arc-danger, #DC2626);
    padding: 10px 14px;
    border-radius: var(--arc-r-sm);
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    font-size: 12px;
  }

  /* Explore */
  .cg-explore {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    align-items: start;
  }
  .detail-pane {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-md);
    overflow: hidden;
    min-height: 300px;
  }

  @media (max-width: 1000px) {
    .cg-explore { grid-template-columns: 1fr; }
  }
</style>
