<script lang="ts">
  // ui/src/lib/ui/chat/ToolItem.svelte — renders a single tool details card.
  // Used in two places in ChatThread.svelte: the inline-tool inside segments
  // and the activity-fallback tool-batch list. Behavior is preserved exactly.
  import Icon from "$lib/icons/Icon.svelte";
  import type { ToolActivity, CanliAktivite } from "$lib/store.svelte";
  import { fmtTokenShort, toolTotalIn, snip } from "./helpers.js";

  let {
    tool,
    onInspect,
    extraClass = "",
  }: {
    tool: ToolActivity | CanliAktivite;
    onInspect?: (t: ToolActivity | CanliAktivite) => void;
    extraClass?: string;
  } = $props();

  function inspectClick(e: MouseEvent) {
    if (!onInspect) return;
    e.preventDefault();
    e.stopPropagation();
    onInspect(tool);
  }
</script>

<details class="tool {extraClass}" class:err={tool.hata}>
  <summary class="tool-sum">
    <Icon name={tool.hata ? "x" : "check"} size={10} stroke={2.6} />
    <span class="tool-name">{tool.ad}</span>
    {#if tool.girdi}<span class="tool-snip">{snip(tool.girdi)}</span>{/if}
    {#if tool.tokens && (toolTotalIn(tool.tokens) > 0 || tool.tokens.out > 0)}
      <span class="tool-tok" title={`Total prompt (in): ${toolTotalIn(tool.tokens)}\n  • new input (uncached): ${tool.tokens.in}\n  • cache_read: ${tool.tokens.cacheRead}\n  • cache_create: ${tool.tokens.cacheCreate}\nout: ${tool.tokens.out}${tool.tokens.usd ? `\nUSD: $${tool.tokens.usd.toFixed(4)}` : ""}`}>
        {fmtTokenShort(toolTotalIn(tool.tokens))}↓ {fmtTokenShort(tool.tokens.out)}↑
      </span>
    {/if}
    {#if onInspect}
      <button
        class="tool-inspect"
        title="Open detail panel"
        onclick={inspectClick}
        aria-label="Tool detail"
      >detail</button>
    {/if}
    {#if extraClass.includes("inline-tool")}
      <Icon name="chevronDown" size={11} class="tool-chev" />
    {/if}
  </summary>
  <div class="tool-detay">
    {#if tool.girdi}
      <div class="tool-io"><span class="tool-k">input</span>{tool.girdi}</div>
    {/if}
    {#if tool.sonuc}
      <div class="tool-io"><span class="tool-k">result</span>{tool.sonuc}</div>
    {/if}
    {#if tool.tokens && (toolTotalIn(tool.tokens) > 0 || tool.tokens.out > 0)}
      <div class="tool-io tool-cost">
        <span class="tool-k">cost</span>
        <span>prompt {fmtTokenShort(toolTotalIn(tool.tokens))} (new {fmtTokenShort(tool.tokens.in)} · cache_read {fmtTokenShort(tool.tokens.cacheRead)} · cache_create {fmtTokenShort(tool.tokens.cacheCreate)}) · out {fmtTokenShort(tool.tokens.out)}{tool.tokens.usd ? ` · $${tool.tokens.usd.toFixed(4)}` : ""}</span>
      </div>
    {/if}
  </div>
</details>

<style>
  /* tool details card — cloned from ChatThread CSS. */
  .tool {
    border: 1px solid var(--arc-border);
    border-radius: 7px;
    background: var(--arc-surface);
    overflow: hidden;
  }
  .tool.err {
    border-color: var(--arc-danger);
    background: color-mix(in srgb, var(--arc-danger) 4%, var(--arc-surface));
  }
  .tool-sum {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
    color: var(--arc-text);
  }
  .tool-sum :global(svg) { color: var(--arc-success); flex-shrink: 0; }
  .tool.err .tool-sum :global(svg:first-child) { color: var(--arc-danger); }
  .tool-name {
    font-weight: 600;
    color: var(--arc-text);
    flex-shrink: 0;
  }
  .tool-snip {
    color: var(--arc-text-faint);
    font-family: var(--arc-mono, monospace);
    font-size: 10.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .tool-tok {
    margin-left: auto;
    font-family: var(--arc-mono, monospace);
    font-size: 10.5px;
    color: var(--arc-text-faint);
    background: color-mix(in srgb, var(--arc-text) 6%, transparent);
    padding: 1px 6px;
    border-radius: 4px;
    flex-shrink: 0;
    cursor: help;
  }
  .tool-inspect {
    background: transparent;
    border: 1px solid var(--arc-border);
    border-radius: 5px;
    padding: 1px 7px;
    font-size: 10px;
    color: var(--arc-text-faint);
    cursor: pointer;
    flex-shrink: 0;
  }
  .tool-inspect:hover {
    color: var(--arc-primary);
    border-color: var(--arc-primary);
  }
  :global(.tool-chev) {
    color: var(--arc-text-faint);
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }
  .tool[open] :global(.tool-chev) { transform: rotate(180deg); }
  .tool-detay {
    border-top: 1px solid var(--arc-border);
    padding: 8px 12px;
    background: var(--arc-bg);
    font-family: var(--arc-mono, monospace);
    font-size: 11px;
    color: var(--arc-text-soft);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tool-io {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .tool-k {
    display: inline-block;
    color: var(--arc-text-faint);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 9.5px;
    margin-right: 6px;
    font-weight: 700;
  }
  .tool-cost {
    border-top: 1px dashed var(--arc-border);
    padding-top: 6px;
    margin-top: 2px;
  }
</style>
