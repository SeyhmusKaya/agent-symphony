<script lang="ts">
  import Icon from "$lib/icons/Icon.svelte";
  import type { IconName } from "$lib/icons/paths";
  import type { ToolActivity } from "$lib/store.svelte";

  let { tools = [] }: { tools: ToolActivity[] } = $props();

  let open = $state(false);

  function snip(s: string): string {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > 70 ? t.slice(0, 70) + "…" : t;
  }

  // Fix 56b: short token format — 1234 -> "1.2k", 12k -> "12k", 1.2M -> "1.2M"
  function fmtTokenShort(n: number): string {
    if (!n || n < 0) return "0";
    if (n < 1000) return String(n);
    if (n < 10_000) return (n / 1000).toFixed(1) + "k";
    if (n < 1_000_000) return Math.round(n / 1000) + "k";
    return (n / 1_000_000).toFixed(1) + "M";
  }

  // Fix 56b: group total tokens + $ usd. Each tool has a single round delta;
  // parallel tools in the same round carry the same delta — so DEDUP per round
  // for the total. Still, the in/out/usd total across all tools is considered.
  // Fix 65: the "in" badge misleadingly showed "0". In turns with a cache hit,
  // even if dUncached=0 the prompt size includes thousands of cache_read tokens.
  // Users misread this as "the tool spent 0 tokens". Fix: show the TOTAL prompt
  // size in the badge (in + cacheRead + cacheCreate); let the tooltip give detail.
  function toolTotalIn(t: { tokens?: { in?: number; cacheRead?: number; cacheCreate?: number } }): number {
    const k = t.tokens;
    if (!k) return 0;
    return (k.in ?? 0) + (k.cacheRead ?? 0) + (k.cacheCreate ?? 0);
  }
  const grupTotalIn = $derived(tools.reduce((s, t) => s + toolTotalIn(t), 0));
  const grupTotalNewIn = $derived(tools.reduce((s, t) => s + (t.tokens?.in ?? 0), 0));
  const grupTotalCacheRead = $derived(tools.reduce((s, t) => s + (t.tokens?.cacheRead ?? 0), 0));
  const grupTotalOut = $derived(tools.reduce((s, t) => s + (t.tokens?.out ?? 0), 0));
  const grupTotalUsd = $derived(tools.reduce((s, t) => s + (t.tokens?.usd ?? 0), 0));

  // "Read N files" style one-line summary — Claude Code style.
  function groupLabel(ad: string, n: number): string {
    switch (ad) {
      case "Read":
        return `Read ${n} files`;
      case "Bash":
        return `Ran ${n} commands`;
      case "Edit":
        return `Edited ${n} files`;
      case "Write":
        return `Wrote ${n} files`;
      case "Grep":
        return `Searched ${n} times`;
      case "Glob":
        return `Found ${n} file sets`;
      default:
        return `Used ${ad} ${n} times`;
    }
  }

  function groupIcon(ad: string): IconName {
    switch (ad) {
      case "Read":
        return "fileText";
      case "Bash":
        return "terminal";
      case "Edit":
        return "edit";
      case "Write":
        return "fileText";
      case "Grep":
        return "search";
      case "Glob":
        return "folder";
      default:
        return "terminal";
    }
  }

  const ad = $derived(tools[0]?.ad ?? "tool");
  const n = $derived(tools.length);
  const anyErr = $derived(tools.some((t) => t.hata));
</script>

<div class="grp" class:open class:err={anyErr}>
  <button
    type="button"
    class="grp-head"
    onclick={() => (open = !open)}
    aria-expanded={open}
  >
    <Icon name={groupIcon(ad)} size={12} stroke={2} />
    <span class="grp-label">{groupLabel(ad, n)}</span>
    {#if anyErr}
      <span class="grp-err">
        <Icon name="x" size={9} stroke={2.6} />
        <span>error</span>
      </span>
    {/if}
    {#if grupTotalIn > 0 || grupTotalOut > 0}
      <span class="grp-tok" title={`Total prompt (in): ${grupTotalIn}\n  • new input (uncached): ${grupTotalNewIn}\n  • cache_read: ${grupTotalCacheRead}\nTotal out: ${grupTotalOut}${grupTotalUsd > 0 ? `\nUSD: $${grupTotalUsd.toFixed(4)}` : ""}`}>
        {fmtTokenShort(grupTotalIn)}↓ {fmtTokenShort(grupTotalOut)}↑
      </span>
    {/if}
    <Icon name="chevronDown" size={12} class="grp-chev" />
  </button>
  {#if open}
    <div class="grp-list">
      {#each tools as t, ti (t.ad + ti)}
        <details class="tool" class:err={t.hata}>
          <summary class="tool-sum">
            <Icon name={t.hata ? "x" : "check"} size={10} stroke={2.6} />
            <span class="tool-name">{t.ad}</span>
            {#if t.girdi}<span class="tool-snip">{snip(t.girdi)}</span>{/if}
            {#if t.tokens && (toolTotalIn(t) > 0 || t.tokens.out > 0)}
              <span class="tool-tok" title={`Total prompt (in): ${toolTotalIn(t)}\n  • new input (uncached): ${t.tokens.in}\n  • cache_read: ${t.tokens.cacheRead}\n  • cache_create: ${t.tokens.cacheCreate}\nout: ${t.tokens.out}${t.tokens.usd ? `\nUSD: $${t.tokens.usd.toFixed(4)}` : ""}`}>
                {fmtTokenShort(toolTotalIn(t))}↓ {fmtTokenShort(t.tokens.out)}↑
              </span>
            {/if}
          </summary>
          <div class="tool-detay">
            {#if t.girdi}
              <div class="tool-io"><span class="tool-k">input</span>{t.girdi}</div>
            {/if}
            {#if t.sonuc}
              <div class="tool-io"><span class="tool-k">result</span>{t.sonuc}</div>
            {/if}
            {#if t.tokens && (toolTotalIn(t) > 0 || t.tokens.out > 0)}
              <div class="tool-io tool-cost">
                <span class="tool-k">cost</span>
                <span>prompt {fmtTokenShort(toolTotalIn(t))} (new {fmtTokenShort(t.tokens.in)} · cache_read {fmtTokenShort(t.tokens.cacheRead)} · cache_create {fmtTokenShort(t.tokens.cacheCreate)}) · out {fmtTokenShort(t.tokens.out)}{t.tokens.usd ? ` · $${t.tokens.usd.toFixed(4)}` : ""}</span>
              </div>
            {/if}
          </div>
        </details>
      {/each}
    </div>
  {/if}
</div>

<style>
  .grp {
    margin-top: 2px;
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    background: #ffffff;
    font-size: 11.5px;
    overflow: hidden;
    align-self: flex-start;
    max-width: 100%;
    transition: border-color 0.15s var(--arc-ease), box-shadow 0.15s var(--arc-ease);
  }
  .grp:hover {
    border-color: var(--arc-primary);
    box-shadow: 0 1px 3px rgba(15, 118, 110, 0.08);
  }
  .grp.err {
    border-color: color-mix(in srgb, var(--arc-danger) 35%, var(--arc-border));
  }
  .grp-head {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    cursor: pointer;
    padding: 7px 11px;
    border: none;
    background: transparent;
    font: inherit;
    color: var(--arc-text-soft);
    user-select: none;
    text-align: left;
  }
  .grp-head :global(svg) {
    color: var(--arc-primary);
    flex-shrink: 0;
  }
  .grp-label {
    font-family: var(--arc-mono);
    color: var(--arc-primary-strong);
    font-weight: 500;
    flex: 1;
    min-width: 0;
  }
  .grp-err {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--arc-danger);
    padding: 1px 6px;
    border-radius: var(--arc-r-pill);
    background: color-mix(in srgb, var(--arc-danger) 10%, transparent);
  }
  .grp-err :global(svg) {
    color: var(--arc-danger);
  }
  .grp-head :global(.grp-chev) {
    margin-left: 2px;
    transition: transform 0.15s var(--arc-ease);
    color: var(--arc-text-faint);
  }
  .grp.open .grp-head :global(.grp-chev) {
    transform: rotate(180deg);
  }
  .grp-list {
    border-top: 1px solid var(--arc-border);
  }
  .tool {
    border-top: 1px solid var(--arc-border);
  }
  .tool:first-child {
    border-top: none;
  }
  .tool-sum {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    padding: 7px 11px;
    list-style: none;
  }
  .tool-sum::-webkit-details-marker {
    display: none;
  }
  .tool-sum:hover {
    background: var(--arc-n50, rgba(0, 0, 0, 0.02));
  }
  .tool-name {
    font-family: var(--arc-mono);
    font-weight: 500;
    color: var(--arc-primary-strong);
    flex-shrink: 0;
  }
  .tool.err .tool-name {
    color: var(--arc-danger);
  }
  .tool-snip {
    font-family: var(--arc-mono);
    color: var(--arc-text-faint);
    font-size: 10.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .tool-detay {
    padding: 4px 11px 9px 27px;
    background: var(--arc-n50, rgba(0, 0, 0, 0.02));
  }
  .tool-io {
    color: var(--arc-text-soft);
    margin-top: 4px;
    word-break: break-word;
  }
  .tool-k {
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--arc-text-faint);
    margin-right: 6px;
  }
  /* Fix 56b: group head + each tool token badge */
  .grp-tok {
    font-family: var(--arc-mono);
    font-size: 10px;
    font-weight: 600;
    color: #0F766E;
    background: #0F766E14;
    padding: 1px 6px;
    border-radius: 5px;
    margin-left: auto;
    margin-right: 4px;
    cursor: help;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  .tool-tok {
    font-family: var(--arc-mono);
    font-size: 10px;
    font-weight: 600;
    color: #0F766E;
    background: #0F766E14;
    padding: 1px 6px;
    border-radius: 5px;
    margin-left: auto;
    margin-right: 4px;
    cursor: help;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }
  .tool-cost {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed var(--arc-border, rgba(0,0,0,0.06));
    font-size: 11px;
    color: var(--arc-text-soft);
    font-variant-numeric: tabular-nums;
  }
</style>
