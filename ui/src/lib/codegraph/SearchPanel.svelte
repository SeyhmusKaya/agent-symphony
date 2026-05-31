<script lang="ts">
  // CodeGraph search bar + active kind filter chip + results list.
  // Parent: holds the search, kindFilter, results states. Clicks are
  // forwarded to the parent via callbacks.
  import { kindBg, kindFg, kindLabel, type CgSymbol } from "./helpers.js";

  interface Props {
    search: string;
    kindFilter: string;
    results: CgSymbol[];
    searching: boolean;
    selectedQname: string | null;
    onSearchInput: (v: string) => void;
    onSearchClear: () => void;
    onKindClear: () => void;
    onSelect: (sym: CgSymbol) => void;
  }
  let {
    search,
    kindFilter,
    results,
    searching,
    selectedQname,
    onSearchInput,
    onSearchClear,
    onKindClear,
    onSelect,
  }: Props = $props();
</script>

<!-- Search bar -->
<div class="search-row">
  <div class="search-wrap">
    <svg class="search-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
    </svg>
    <input
      class="search-input"
      type="text"
      placeholder="Search symbols — function, class, method name…"
      value={search}
      oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
    />
    {#if search}
      <button class="search-clear" onclick={onSearchClear} aria-label="Clear">×</button>
    {/if}
  </div>
  {#if kindFilter}
    <div class="active-filter" style="--kc:{kindFg(kindFilter)}; --kb:{kindBg(kindFilter)}">
      {kindLabel(kindFilter)}
      <button onclick={onKindClear}>×</button>
    </div>
  {/if}
</div>

<!-- Results list -->
<div class="results-pane">
  <div class="pane-head">
    <span>Results</span>
    <span class="pane-count">{results.length}</span>
  </div>
  <div class="results-body">
    {#if searching}
      <div class="empty-state">
        <div class="empty-text">Searching…</div>
      </div>
    {:else if !search && !kindFilter}
      <div class="empty-state">
        <div class="empty-ico">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
          </svg>
        </div>
        <div class="empty-text">Type a symbol name or pick a type</div>
        <div class="empty-hint">FTS5 fast search — function / class / method</div>
      </div>
    {:else if results.length === 0}
      <div class="empty-state">
        <div class="empty-text">No results</div>
        <div class="empty-hint">
          {#if search && kindFilter}No {kindLabel(kindFilter)} symbols match "{search}"
          {:else if search}No symbols found for "{search}"
          {:else}No {kindLabel(kindFilter)} symbols in the index
          {/if}
        </div>
      </div>
    {:else}
      {#each results as r}
        <button
          class="result-row"
          class:active={selectedQname === r.qname}
          onclick={() => onSelect(r)}
        >
          <span class="kind-tag" style="background:{kindBg(r.kind)}; color:{kindFg(r.kind)}">
            {kindLabel(r.kind)}
          </span>
          <span class="result-name">{r.name}</span>
          <span class="result-path">{r.path}:{r.startLine}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .search-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .search-wrap {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
  }
  .search-ico {
    position: absolute;
    left: 12px;
    color: var(--arc-text-faint);
    pointer-events: none;
  }
  .search-input {
    width: 100%;
    padding: 10px 38px 10px 38px;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-md);
    font-size: 13px;
    color: var(--arc-text);
    transition: border 0.15s;
  }
  .search-input:focus {
    outline: none;
    border-color: var(--arc-primary);
  }
  .search-clear {
    position: absolute;
    right: 8px;
    width: 22px;
    height: 22px;
    border: none;
    background: var(--arc-n100);
    border-radius: 50%;
    color: var(--arc-text-soft);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }
  .active-filter {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 10px;
    background: var(--kb);
    color: var(--kc);
    border: 1px solid var(--kc);
    border-radius: var(--arc-r-sm);
    font-size: 11px;
    font-weight: 600;
  }
  .active-filter button {
    border: none;
    background: transparent;
    color: var(--kc);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
  }

  /* Results pane */
  .results-pane {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-md);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 300px;
  }
  .pane-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: var(--arc-n100);
    border-bottom: 1px solid var(--arc-border);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--arc-text-faint);
  }
  .pane-count {
    background: var(--arc-surface);
    color: var(--arc-text);
    padding: 1px 7px;
    border-radius: 10px;
    font-size: 10px;
  }
  .results-body {
    flex: 1;
    overflow-y: auto;
    max-height: 480px;
  }

  .empty-state {
    padding: 40px 20px;
    text-align: center;
    color: var(--arc-text-soft);
  }
  .empty-ico { color: var(--arc-text-faint); margin-bottom: 10px; }
  .empty-text { font-size: 13px; font-weight: 500; margin-bottom: 4px; }
  .empty-hint { font-size: 11px; color: var(--arc-text-faint); }

  .result-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border: none;
    background: transparent;
    border-bottom: 1px solid var(--arc-border-soft, var(--arc-border));
    cursor: pointer;
    transition: background 0.1s;
    text-align: left;
  }
  .result-row:last-child { border-bottom: none; }
  .result-row:hover { background: var(--arc-n100); }
  .result-row.active { background: var(--arc-primary-soft, #0F766E1A); }
  .result-name {
    flex: 1;
    font-weight: 600;
    font-size: 13px;
    color: var(--arc-text);
    font-family: var(--arc-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .result-path {
    font-size: 11px;
    color: var(--arc-text-faint);
    font-family: var(--arc-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 40%;
  }

  .kind-tag {
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: capitalize;
    flex-shrink: 0;
  }
</style>
