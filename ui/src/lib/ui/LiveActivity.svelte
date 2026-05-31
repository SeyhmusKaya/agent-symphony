<script lang="ts">
  import Icon from "$lib/icons/Icon.svelte";
  import type { CanliAktivite } from "$lib/store.svelte";

  let {
    aktivite = [],
    elapsed = 0,
    tokens = 0,
    liveIn = 0,
    liveOut = 0,
    liveCacheRead = 0,
    liveCacheCreate = 0,
    liveUncached = 0,
    liveUsd = 0,
    label = "Chief",
    error = null,
  }: {
    aktivite?: CanliAktivite[];
    elapsed?: number;
    tokens?: number;
    liveIn?: number;
    liveOut?: number;
    liveCacheRead?: number;
    liveCacheCreate?: number;
    liveUncached?: number;
    liveUsd?: number;
    label?: string;
    error?: string | null;
  } = $props();

  const calisiyor = $derived(aktivite.some((a) => a.durum === "calisiyor"));

  function fmtElapsed(s: number): string {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }
  function fmtTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  }
  function fmtUsd(n: number): string {
    if (n < 0.005) return "$0.00";
    if (n < 1) return `$${n.toFixed(3)}`;
    if (n < 100) return `$${n.toFixed(2)}`;
    return `$${n.toFixed(0)}`;
  }
  // Color thresholds — gentle ramp so the user does not "panic".
  function usdTone(n: number): string {
    if (n < 0.5) return "ok";
    if (n < 2) return "warn";
    if (n < 5) return "hot";
    return "red";
  }
  // Cache hit rate — cache_read / (cache_read + uncached + cache_create)
  const hitPct = $derived(
    liveCacheRead + liveUncached + liveCacheCreate > 0
      ? Math.round(
          (liveCacheRead / (liveCacheRead + liveUncached + liveCacheCreate)) * 100,
        )
      : 0,
  );
  const usdLabel = $derived(fmtUsd(liveUsd));
  const tone = $derived(usdTone(liveUsd));
  const tooltip = $derived(
    `in ${fmtTokens(liveIn)} · ` +
    `cache_read ${fmtTokens(liveCacheRead)} (~$${(liveCacheRead * 0.6 / 1_000_000).toFixed(4)}) · ` +
    `cache_create_1h ${fmtTokens(liveCacheCreate)} · ` +
    `fresh ${fmtTokens(liveUncached)} · ` +
    `out ${fmtTokens(liveOut)}`,
  );
</script>

<div class="live">
  <div class="live-top">
    {#if calisiyor}
      <span class="live-spin"><Icon name="loader" size={13} stroke={2.4} spin /></span>
    {:else}
      <span class="live-dots" aria-hidden="true">
        <span></span><span></span><span></span>
      </span>
    {/if}
    <span class="live-label">
      {calisiyor ? "Running tool" : "Thinking"}
    </span>
    <span class="live-stat" title={tooltip}>
      {fmtElapsed(elapsed)}
      {#if liveUsd > 0}
        <span class="live-usd" data-tone={tone}>{usdLabel}</span>
      {/if}
      {#if liveCacheRead > 0}
        <span class="live-cache">cache {fmtTokens(liveCacheRead)} ({hitPct}%)</span>
      {/if}
      <span class="live-out">in {fmtTokens(liveIn)} / out {fmtTokens(liveOut)}</span>
    </span>
  </div>
  {#if error}
    <div class="live-error">
      <Icon name="x" size={12} stroke={2.6} />
      <span>{error}</span>
    </div>
  {/if}
  <!-- live-tools row removed (per user request): the tool chip series under Thinking is not shown. -->
</div>

<style>
  .live {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 11px 14px;
    border-radius: var(--arc-r);
    background: transparent;
    border: none;
  }
  .live-top {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .live-spin {
    display: grid;
    place-items: center;
    color: var(--arc-primary);
  }
  .live-dots {
    display: inline-flex;
    gap: 3px;
  }
  .live-dots span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--arc-primary);
    animation: live-bounce 1.1s var(--arc-ease) infinite;
  }
  .live-dots span:nth-child(2) {
    animation-delay: 0.16s;
  }
  .live-dots span:nth-child(3) {
    animation-delay: 0.32s;
  }
  @keyframes live-bounce {
    0%,
    70%,
    100% {
      opacity: 0.25;
      transform: translateY(0);
    }
    35% {
      opacity: 1;
      transform: translateY(-3px);
    }
  }
  .live-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--arc-primary-strong);
  }
  .live-stat {
    margin-left: auto;
    font-size: 11px;
    font-family: var(--arc-mono);
    color: var(--arc-text-faint);
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .live-usd {
    font-weight: 700;
    padding: 2px 7px;
    border-radius: var(--arc-r-pill);
    border: 1px solid currentColor;
    color: var(--arc-text-soft);
  }
  .live-usd[data-tone="ok"] {
    color: #16a34a;
  }
  .live-usd[data-tone="warn"] {
    color: #ca8a04;
  }
  .live-usd[data-tone="hot"] {
    color: #ea580c;
  }
  .live-usd[data-tone="red"] {
    color: var(--arc-danger);
    background: color-mix(in srgb, var(--arc-danger) 10%, transparent);
  }
  .live-cache {
    color: var(--arc-primary-strong);
  }
  .live-out {
    color: var(--arc-text-faint);
  }
  .live-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .live-tool {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    font-family: var(--arc-mono);
    font-weight: 500;
    border-radius: var(--arc-r-sm);
    padding: 3px 7px;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    color: var(--arc-text-soft);
  }
  .live-tool[data-durum="calisiyor"] {
    border-color: var(--arc-primary);
    color: var(--arc-primary-strong);
  }
  .live-tool[data-durum="bitti"] {
    opacity: 0.6;
  }
  .live-tool[data-durum="hata"] {
    border-color: var(--arc-danger);
    color: var(--arc-danger);
  }
  .live-error {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 9px;
    border-radius: var(--arc-r-sm);
    background: color-mix(in srgb, var(--arc-danger) 12%, transparent);
    border: 1px solid var(--arc-danger);
    color: var(--arc-danger);
    font-size: 11.5px;
    font-weight: 600;
  }
</style>
