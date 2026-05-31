<script lang="ts">
  // ui/src/lib/ui/chat/CostLine.svelte — the cost line below the chief message.
  // Moved from ChatThread.svelte lines 561-631.
  // Fix 74 (cache hit denom), Fix 80 (TTL 5min), Fix 97 (plain inline), Fix 102
  // (model badge), Fix 105 (uncached/cc/cr breakdown tags) are collected here.
  import type { ChatMessage } from "$lib/store.svelte";
  import { fmtTime, fmtTok } from "./helpers.js";

  let {
    msg,
    prevSefMsg = null,
  }: {
    msg: ChatMessage;
    // Previous chief message — for the TTL 5min calculation (gapMs).
    prevSefMsg?: ChatMessage | null;
  } = $props();

  const c = $derived(msg.cost);
  const cacheCreateAll = $derived(c ? (c.cacheCreate1h ?? 0) : 0);
  const cacheReadAll = $derived(c ? (c.cacheRead ?? 0) : 0);
  const uncachedAll = $derived(c ? (c.uncached ?? 0) : 0);
  const hasCost = $derived(!!c && (c.in > 0 || c.out > 0));

  // Fix 80: TTL 5min expiry — if the gap from the previous chief message to this
  // one is > 5min AND cacheCreate > 5000, show a "TTL passed" badge (so the user
  // understands why it was expensive).
  const gapMs = $derived(
    (prevSefMsg && prevSefMsg.ts && msg.ts) ? (msg.ts - prevSefMsg.ts) : 0,
  );
  const ttlExpired = $derived(gapMs > 300_000 && cacheCreateAll > 5000);
  const gapMin = $derived(Math.round(gapMs / 60_000));

  // Fix 74: cache hit %, excluding cacheCreate. The old formula also added
  // cacheCreate to the denominator, producing misleading values like 50% on the
  // first turn. Correct: cacheRead/(cacheRead+uncached). 0% on a cold turn,
  // 99%+ on a warm turn. (Kept for statistics; not shown in the UI — stays in the tooltip.)

  const tooltipText = $derived(
    c
      ? `Cost of this turn (NOT the session total):\ncache_read ${fmtTok(cacheReadAll)} · cache_create_1h ${fmtTok(cacheCreateAll)} (new cache investment, cold start)\nfresh ${fmtTok(uncachedAll)} (real new input)\nout ${fmtTok(c.out)} · model ${c.model ?? "?"}\n\nCache hit% = cache_read / (cache_read + fresh). cache_create is excluded.${ttlExpired ? `\n\nTTL: ${gapMin}min have passed since the previous call (>5min). The Anthropic ephemeral cache was cleared, so cache_create ran again.` : ""}`
      : "",
  );
</script>

<div class="ts-cost-line" title={tooltipText}>
  {#if msg.ts}<span class="tsc-time">{fmtTime(msg.ts)}</span>{/if}
  {#if msg.ts && hasCost}<span class="tsc-sep">--</span>{/if}
  {#if hasCost}
    <!-- Fix 105: breakdown display — show the raw components to answer the
         user's "why 5.86?" question. -->
    {#if uncachedAll > 0 || cacheCreateAll > 0 || cacheReadAll > 0}
      <span class="tsc-tokens" title="prompt = uncached (fresh billed) + cache_create (new cache investment) + cache_read (cache hit)">
        {#if uncachedAll > 0}<span class="tsc-tag" data-tone="uncached" title="Fresh input — billed at the input rate">fresh {fmtTok(uncachedAll)}</span>{/if}
        {#if cacheCreateAll > 0}<span class="tsc-tag" data-tone="cc" title="Cache create — 1.25x (5m) or 2x (1h) of the input rate">cc {fmtTok(cacheCreateAll)}</span>{/if}
        {#if cacheReadAll > 0}<span class="tsc-tag" data-tone="cr" title="Cache read — 0.1x of the input rate">cr {fmtTok(cacheReadAll)}</span>{/if}
        <span class="tsc-tag" data-tone="out" title="Output — tokens produced by the model">out {fmtTok(c!.out)}</span>
      </span>
    {:else}
      <span class="tsc-tokens">{fmtTok(c!.in)} in · {fmtTok(c!.out)} out</span>
    {/if}
    {#if ttlExpired}
      <span class="tsc-ttl" title="{gapMin}min have passed since the previous call. The Anthropic 5min ephemeral cache TTL expired, so cache_create was required again. That is why this message is more expensive than a normal warm call.">TTL {gapMin}min passed</span>
    {/if}
    {#if c!.model}
      <!-- Fix 102: model name inline. To understand why the message price is
           what it is, which model produced it should be visible. -->
      <span class="tsc-model" title={`This message was produced with the ${c!.model} model`}>{c!.model.replace(/^claude-/, "").slice(0, 20)}</span>
    {/if}
    {#if c!.usd && c!.usd > 0}
      <span class="tsc-usd" data-tone={c!.usd < 0.5 ? "ok" : c!.usd < 2 ? "warn" : c!.usd < 5 ? "hot" : "red"}>
        ${c!.usd < 1 ? c!.usd.toFixed(3) : c!.usd.toFixed(2)}
      </span>
    {/if}
  {/if}
</div>

<style>
  /* ts-cost-line — exact clone of ChatThread CSS. */
  .ts-cost-line {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 6px;
    padding: 4px 0 2px;
    font-size: 10.5px;
    color: var(--arc-text-faint);
    flex-wrap: wrap;
    cursor: help;
  }
  .tsc-time {
    font-family: var(--arc-mono, monospace);
    font-size: 10px;
    letter-spacing: 0.02em;
    color: var(--arc-text-faint);
  }
  .tsc-sep {
    color: color-mix(in srgb, var(--arc-text-faint) 50%, transparent);
    font-size: 10px;
  }
  .tsc-tokens {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--arc-mono, monospace);
    font-size: 10.5px;
  }
  .tsc-tag {
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    line-height: 1.4;
    background: color-mix(in srgb, var(--arc-text) 5%, transparent);
    color: var(--arc-text-soft);
    cursor: help;
  }
  .tsc-tag[data-tone="uncached"] {
    background: color-mix(in srgb, #ef4444 14%, transparent);
    color: #c43f3f;
  }
  .tsc-tag[data-tone="cc"] {
    background: color-mix(in srgb, #f59e0b 14%, transparent);
    color: #b87d0a;
  }
  .tsc-tag[data-tone="cr"] {
    background: color-mix(in srgb, var(--arc-primary) 14%, transparent);
    color: var(--arc-primary-strong, var(--arc-primary));
  }
  .tsc-tag[data-tone="out"] {
    background: color-mix(in srgb, var(--arc-text) 8%, transparent);
    color: var(--arc-text);
  }
  .tsc-ttl {
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 9.5px;
    font-weight: 600;
    background: color-mix(in srgb, #f59e0b 16%, transparent);
    color: #a06b08;
    cursor: help;
  }
  .tsc-model {
    font-family: var(--arc-mono, monospace);
    font-size: 9.5px;
    color: var(--arc-text-faint);
    background: color-mix(in srgb, var(--arc-text) 5%, transparent);
    padding: 1px 5px;
    border-radius: 4px;
    cursor: help;
  }
  .tsc-usd {
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10.5px;
    margin-left: auto;
  }
  .tsc-usd[data-tone="ok"] {
    color: var(--arc-success, #16a34a);
    background: color-mix(in srgb, var(--arc-success, #16a34a) 12%, transparent);
  }
  .tsc-usd[data-tone="warn"] {
    color: #b87d0a;
    background: color-mix(in srgb, #f59e0b 14%, transparent);
  }
  .tsc-usd[data-tone="hot"] {
    color: #d4541b;
    background: color-mix(in srgb, #f97316 16%, transparent);
  }
  .tsc-usd[data-tone="red"] {
    color: #c43f3f;
    background: color-mix(in srgb, #ef4444 16%, transparent);
  }
</style>
