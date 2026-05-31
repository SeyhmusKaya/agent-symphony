<script lang="ts">
  // CodeGraph symbol detail panel — signature, callers, callees, imports.
  // Parent: after selectSymbol(...), fills loadingDetails + the result arrays
  // and passes them in here.
  import {
    kindBg,
    kindFg,
    kindLabel,
    type CgSymbol,
    type RelatedSymbol,
    type ImportsData,
  } from "./helpers.js";

  interface Props {
    selected: CgSymbol | null;
    callers: RelatedSymbol[];
    callees: RelatedSymbol[];
    imports: ImportsData | null;
    loadingDetails: boolean;
  }
  let { selected, callers, callees, imports, loadingDetails }: Props = $props();
</script>

{#if !selected}
  <div class="empty-state">
    <div class="empty-ico">
      <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <path d="M14 2v6h6M8 14h8M8 10h3M8 18h6"/>
      </svg>
    </div>
    <div class="empty-text">Select a symbol for details</div>
    <div class="empty-hint">Callers · Callees · Imports will appear here</div>
  </div>
{:else}
  <!-- Symbol header -->
  <div class="detail-head">
    <div class="detail-title-row">
      <span class="kind-tag" style="background:{kindBg(selected.kind)}; color:{kindFg(selected.kind)}">
        {kindLabel(selected.kind)}
      </span>
      <h2 class="detail-title">{selected.name}</h2>
      {#if selected.isExported}
        <span class="exported-badge">exported</span>
      {/if}
    </div>
    <div class="detail-meta">
      <span class="meta-label">File:</span>
      <span class="meta-val">{selected.path}</span>
      <span class="meta-sep">·</span>
      <span class="meta-label">Lines:</span>
      <span class="meta-val">{selected.startLine}–{selected.endLine}</span>
      <span class="meta-sep">·</span>
      <span class="meta-val">{selected.endLine - selected.startLine + 1} lines</span>
    </div>
    <div class="detail-qname">{selected.qname}</div>
  </div>

  {#if selected.signature}
    <div class="detail-section">
      <div class="section-title">Signature</div>
      <pre class="code-block"><code>{selected.signature}</code></pre>
    </div>
  {/if}

  <div class="detail-section">
    <div class="section-title">
      Callers
      <span class="section-count">{callers.length}</span>
    </div>
    {#if loadingDetails}
      <div class="empty-state empty-sm">Loading…</div>
    {:else if callers.length === 0}
      <div class="empty-state empty-sm">No callers — this is an entry point or orphan.</div>
    {:else}
      <ul class="rel-list">
        {#each callers as c}
          <li class="rel-item">
            <span class="kind-tag sm" style="background:{kindBg(c.kind)}; color:{kindFg(c.kind)}">{kindLabel(c.kind)}</span>
            <span class="rel-name">{c.name}</span>
            <span class="rel-qname">{c.qname}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="detail-section">
    <div class="section-title">
      Callees
      <span class="section-count">{callees.length}</span>
    </div>
    {#if loadingDetails}
      <div class="empty-state empty-sm">Loading…</div>
    {:else if callees.length === 0}
      <div class="empty-state empty-sm">This symbol calls nothing.</div>
    {:else}
      <ul class="rel-list">
        {#each callees as c}
          <li class="rel-item">
            <span class="kind-tag sm" style="background:{kindBg(c.kind)}; color:{kindFg(c.kind)}">{kindLabel(c.kind)}</span>
            <span class="rel-name">{c.name}</span>
            <span class="rel-qname">{c.qname}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if imports}
    <div class="detail-section">
      <div class="section-title">
        Imports (outbound)
        <span class="section-count">{imports.outbound.length}</span>
      </div>
      {#if imports.outbound.length === 0}
        <div class="empty-state empty-sm">This file imports nothing.</div>
      {:else}
        <ul class="import-list">
          {#each imports.outbound as i}<li class="import-item">{i}</li>{/each}
        </ul>
      {/if}
    </div>

    <div class="detail-section">
      <div class="section-title">
        Imported by (inbound)
        <span class="section-count">{imports.inbound.length}</span>
      </div>
      {#if imports.inbound.length === 0}
        <div class="empty-state empty-sm">Nothing imports this file.</div>
      {:else}
        <ul class="import-list">
          {#each imports.inbound as i}<li class="import-item">{i}</li>{/each}
        </ul>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .empty-state {
    padding: 40px 20px;
    text-align: center;
    color: var(--arc-text-soft);
  }
  .empty-state.empty-sm {
    padding: 16px;
    font-size: 12px;
    text-align: left;
    color: var(--arc-text-faint);
  }
  .empty-ico { color: var(--arc-text-faint); margin-bottom: 10px; }
  .empty-text { font-size: 13px; font-weight: 500; margin-bottom: 4px; }
  .empty-hint { font-size: 11px; color: var(--arc-text-faint); }

  .detail-head {
    padding: 16px;
    border-bottom: 1px solid var(--arc-border);
  }
  .detail-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .detail-title {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: var(--arc-text);
    font-family: var(--arc-mono);
  }
  .exported-badge {
    background: var(--arc-primary-soft, #0F766E1A);
    color: var(--arc-primary, #0F766E);
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .detail-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--arc-text-soft);
    font-family: var(--arc-mono);
    margin-bottom: 6px;
  }
  .meta-label { color: var(--arc-text-faint); font-weight: 600; }
  .meta-val { color: var(--arc-text); }
  .meta-sep { color: var(--arc-text-faint); }
  .detail-qname {
    font-size: 11px;
    font-family: var(--arc-mono);
    color: var(--arc-text-faint);
    word-break: break-all;
  }

  .detail-section {
    padding: 14px 16px;
    border-bottom: 1px solid var(--arc-border-soft, var(--arc-border));
  }
  .detail-section:last-child { border-bottom: none; }
  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--arc-text-faint);
    margin-bottom: 8px;
  }
  .section-count {
    background: var(--arc-n100);
    color: var(--arc-text);
    padding: 1px 7px;
    border-radius: 10px;
    font-size: 10px;
  }

  .code-block {
    background: var(--arc-n100);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    padding: 10px 12px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--arc-text);
    overflow-x: auto;
    margin: 0;
  }
  .code-block code {
    font-family: var(--arc-mono);
    white-space: pre;
  }

  .rel-list, .import-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rel-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--arc-n100);
    border-radius: var(--arc-r-sm);
    font-size: 12px;
  }
  .rel-name {
    font-weight: 600;
    color: var(--arc-text);
    font-family: var(--arc-mono);
  }
  .rel-qname {
    color: var(--arc-text-faint);
    font-size: 10px;
    font-family: var(--arc-mono);
    margin-left: auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .import-item {
    padding: 5px 8px;
    background: var(--arc-n100);
    border-radius: var(--arc-r-sm);
    font-size: 11px;
    font-family: var(--arc-mono);
    color: var(--arc-text);
    word-break: break-all;
  }

  .kind-tag {
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: capitalize;
    flex-shrink: 0;
  }
  .kind-tag.sm {
    padding: 1px 5px;
    font-size: 9px;
  }
</style>
