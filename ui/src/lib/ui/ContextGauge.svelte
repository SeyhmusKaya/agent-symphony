<script lang="ts">
  let {
    used = 0,
    total = 1,
    onclick,
  }: { used?: number; total?: number; onclick?: () => void } = $props();

  const pct = $derived(
    total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0,
  );
  const R = 9;
  const CIRC = 2 * Math.PI * R;
  const dash = $derived((pct / 100) * CIRC);
  const tone = $derived(pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok");

  function fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
    return String(n);
  }

  const tip = $derived(
    onclick
      ? `${fmt(used)} / ${fmt(total)} context · ${fmt(Math.max(0, total - used))} left · click to compact`
      : `${fmt(used)} / ${fmt(total)} context · ${fmt(Math.max(0, total - used))} left`,
  );
</script>

{#snippet inner()}
  <svg viewBox="0 0 24 24" width="24" height="24">
    <circle class="track" cx="12" cy="12" r={R} />
    <circle
      class="prog"
      cx="12"
      cy="12"
      r={R}
      stroke-dasharray="{dash} {CIRC}"
      transform="rotate(-90 12 12)"
    />
  </svg>
  <span class="pct">%{pct}</span>
{/snippet}

{#if onclick}
  <button
    type="button"
    class="gauge interactive"
    class:danger={tone === "danger"}
    class:warn={tone === "warn"}
    title={tip}
    onclick={onclick}
  >
    {@render inner()}
  </button>
{:else}
  <div
    class="gauge"
    class:danger={tone === "danger"}
    class:warn={tone === "warn"}
    title={tip}
  >
    {@render inner()}
  </div>
{/if}

<style>
  .gauge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: default;
    background: transparent;
    border: none;
    padding: 4px 8px;
    border-radius: var(--arc-r-pill);
    transition: background 0.15s var(--arc-ease), transform 0.15s var(--arc-ease);
  }
  .gauge.interactive {
    cursor: pointer;
  }
  .gauge.interactive:hover {
    background: var(--arc-n100);
    transform: translateY(-1px);
  }
  .gauge.interactive:hover .prog {
    stroke-width: 3.5;
  }
  .gauge.interactive:active {
    transform: translateY(0);
  }
  svg {
    flex: none;
  }
  .track {
    fill: none;
    stroke: var(--arc-n200);
    stroke-width: 3;
  }
  .prog {
    fill: none;
    stroke: var(--arc-primary);
    stroke-width: 3;
    stroke-linecap: round;
    transition: stroke-dasharray 0.4s var(--arc-ease), stroke 0.3s var(--arc-ease),
      stroke-width 0.15s var(--arc-ease);
  }
  .warn .prog {
    stroke: var(--arc-warn);
  }
  .danger .prog {
    stroke: var(--arc-danger);
  }
  .pct {
    font-size: 11px;
    font-family: var(--arc-mono);
    font-weight: 600;
    color: var(--arc-text-soft);
  }
  .warn .pct {
    color: var(--arc-warn);
  }
  .danger .pct {
    color: var(--arc-danger);
  }
</style>
