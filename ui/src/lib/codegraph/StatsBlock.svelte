<script lang="ts">
  // CodeGraph stats cards + language distribution + symbol kinds chip grid.
  // Parent: holds the kindFilter state; `onKindClick(kind)` is called on chip click.
  import {
    fmtNum,
    fmtDate,
    fmtAgo,
    kindBg,
    kindFg,
    kindLabel,
    LANG_LABEL,
    LANG_COLOR,
    type Stats,
  } from "./helpers.js";

  interface Props {
    stats: Stats | null;
    kindFilter: string;
    onKindClick: (kind: string) => void;
  }
  let { stats, kindFilter, onKindClick }: Props = $props();

  const availableKinds = $derived.by(() => {
    if (!stats?.kinds) return [] as { kind: string; count: number }[];
    return Object.entries(stats.kinds)
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count);
  });

  const sortedLanguages = $derived.by(() => {
    if (!stats?.languages) return [] as { lang: string; count: number; pct: number }[];
    const total = Object.values(stats.languages).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(stats.languages)
      .map(([lang, count]) => ({ lang, count, pct: (count / total) * 100 }))
      .sort((a, b) => b.count - a.count);
  });
</script>

<!-- Stats grid: 4 cards -->
<div class="cg-stats">
  <div class="stat-card">
    <div class="stat-icon" style="background:#0F766E14; color:#0F766E">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <path d="M14 2v6h6"/>
      </svg>
    </div>
    <div class="stat-body">
      <div class="stat-cap">Files</div>
      <div class="stat-val">{stats ? fmtNum(stats.files) : "—"}</div>
      <div class="stat-sub">indexed source files</div>
    </div>
  </div>

  <div class="stat-card">
    <div class="stat-icon" style="background:#0891B214; color:#0891B2">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M4 7h16M4 12h16M4 17h10"/>
      </svg>
    </div>
    <div class="stat-body">
      <div class="stat-cap">Symbols</div>
      <div class="stat-val">{stats ? fmtNum(stats.symbols) : "—"}</div>
      <div class="stat-sub">functions + classes + …</div>
    </div>
  </div>

  <div class="stat-card">
    <div class="stat-icon" style="background:#A21CAF14; color:#A21CAF">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/>
        <circle cx="18" cy="6" r="2"/><path d="M8 6h8M6 8v8M18 8v8"/>
      </svg>
    </div>
    <div class="stat-body">
      <div class="stat-cap">Edges</div>
      <div class="stat-val">{stats ? fmtNum(stats.edges) : "—"}</div>
      <div class="stat-sub">calls + imports</div>
    </div>
  </div>

  <div class="stat-card">
    <div class="stat-icon" style="background:#B4530914; color:#B45309">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
      </svg>
    </div>
    <div class="stat-body">
      <div class="stat-cap">Last Index</div>
      <div class="stat-val stat-val-sm">{stats ? fmtAgo(stats.lastFullIndex) : "—"}</div>
      <div class="stat-sub" title={stats ? fmtDate(stats.lastFullIndex) : ""}>{stats ? fmtDate(stats.lastFullIndex) : ""}</div>
    </div>
  </div>
</div>

<!-- Language + Kind breakdown -->
{#if sortedLanguages.length > 0 || availableKinds.length > 0}
  <div class="cg-breakdown">
    {#if sortedLanguages.length > 0}
      <div class="bd-panel">
        <div class="bd-title">Language Distribution</div>
        <div class="bd-bar">
          {#each sortedLanguages as l}
            <div
              class="bd-seg"
              style="width:{l.pct}%; background:{LANG_COLOR[l.lang] ?? '#475569'}"
              title="{LANG_LABEL[l.lang] ?? l.lang}: {fmtNum(l.count)} files ({l.pct.toFixed(1)}%)"
            ></div>
          {/each}
        </div>
        <div class="bd-legend">
          {#each sortedLanguages as l}
            <div class="bd-leg-item">
              <span class="bd-dot" style="background:{LANG_COLOR[l.lang] ?? '#475569'}"></span>
              <span class="bd-lang">{LANG_LABEL[l.lang] ?? l.lang}</span>
              <span class="bd-count">{fmtNum(l.count)}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if availableKinds.length > 0}
      <div class="bd-panel">
        <div class="bd-title">Symbol Types</div>
        <div class="kinds-grid">
          {#each availableKinds.slice(0, 9) as k}
            <button
              class="kind-chip"
              class:active={kindFilter === k.kind}
              onclick={() => onKindClick(k.kind)}
              style="--kc:{kindFg(k.kind)}; --kb:{kindBg(k.kind)}"
            >
              <span>{kindLabel(k.kind)}</span>
              <span class="kind-n">{fmtNum(k.count)}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Stats */
  .cg-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  .stat-card {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-md);
    padding: 14px;
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .stat-icon {
    width: 36px;
    height: 36px;
    border-radius: var(--arc-r-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .stat-body { flex: 1; min-width: 0; }
  .stat-cap {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--arc-text-faint);
    margin-bottom: 3px;
  }
  .stat-val {
    font-size: 22px;
    font-weight: 700;
    color: var(--arc-text);
    line-height: 1.1;
    margin-bottom: 2px;
  }
  .stat-val-sm { font-size: 15px; }
  .stat-sub {
    font-size: 11px;
    color: var(--arc-text-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Breakdown */
  .cg-breakdown {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 16px;
  }
  .bd-panel {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-md);
    padding: 14px;
  }
  .bd-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--arc-text-faint);
    margin-bottom: 10px;
  }
  .bd-bar {
    display: flex;
    height: 10px;
    border-radius: 5px;
    overflow: hidden;
    margin-bottom: 10px;
    background: var(--arc-n100);
  }
  .bd-seg { height: 100%; min-width: 2px; }
  .bd-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .bd-leg-item {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--arc-text-soft);
  }
  .bd-dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .bd-lang { font-weight: 500; color: var(--arc-text); }
  .bd-count { color: var(--arc-text-faint); }

  /* Kinds grid */
  .kinds-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .kind-chip {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    background: var(--kb);
    color: var(--kc);
    border: 1px solid transparent;
    border-radius: var(--arc-r-sm);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .kind-chip:hover { transform: translateY(-1px); }
  .kind-chip.active { border-color: var(--kc); }
  .kind-n {
    background: rgba(255, 255, 255, 0.5);
    padding: 1px 5px;
    border-radius: 8px;
    font-size: 10px;
  }

  @media (max-width: 900px) {
    .cg-breakdown { grid-template-columns: 1fr; }
  }
</style>
