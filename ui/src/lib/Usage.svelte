<script lang="ts">
  import { onMount } from "svelte";
  import { aggregateUsage, turnMetricsSummary, type DayUsage, type TurnMetricsSummary } from "$lib/api";

  let all = $state<DayUsage[]>([]);
  let period = $state<7 | 30>(7);
  let loading = $state(true);
  let turnSum = $state<TurnMetricsSummary | null>(null);

  // Pricing (USD / 1M tokens). Approx. average of Sonnet-4-6 + Opus-4-7.
  // User runs a mix of opus + sonnet. This is an estimate — shown in the UI
  // with an "approximate" note.
  const PRICE_IN = 5; // $5 / 1M input (cache mix)
  const PRICE_OUT = 25; // $25 / 1M output

  const days = $derived(buildRange(period, all));
  const maxTotal = $derived(Math.max(1, ...days.map((d) => d.input + d.output)));
  const today = $derived(() => {
    const key = new Date().toISOString().slice(0, 10);
    const rec = all.find((d) => d.date === key);
    return rec ? rec.input + rec.output : 0;
  });
  const todayIn = $derived(() => {
    const key = new Date().toISOString().slice(0, 10);
    return all.find((d) => d.date === key)?.input ?? 0;
  });
  const todayOut = $derived(() => {
    const key = new Date().toISOString().slice(0, 10);
    return all.find((d) => d.date === key)?.output ?? 0;
  });
  const periodTotal = $derived(
    days.reduce((s, d) => s + d.input + d.output, 0),
  );
  const periodIn = $derived(days.reduce((s, d) => s + d.input, 0));
  const periodOut = $derived(days.reduce((s, d) => s + d.output, 0));
  const periodAvg = $derived(Math.round(periodTotal / period));
  const periodCost = $derived(
    (periodIn * PRICE_IN + periodOut * PRICE_OUT) / 1_000_000,
  );
  const activeDays = $derived(days.filter((d) => d.input + d.output > 0).length);
  const peakDay = $derived(() => {
    if (days.length === 0) return null;
    let max = days[0];
    for (const d of days) {
      if (d.input + d.output > max.input + max.output) max = d;
    }
    return max;
  });

  function buildRange(n: number, source: DayUsage[]): DayUsage[] {
    const map = new Map(source.map((d) => [d.date, d]));
    const out: DayUsage[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const dt = new Date();
      dt.setDate(dt.getDate() - i);
      const key = dt.toISOString().slice(0, 10);
      out.push(map.get(key) ?? { date: key, input: 0, output: 0 });
    }
    return out;
  }

  function fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  }

  function fmtUsd(n: number): string {
    if (n < 0.01) return "<$0.01";
    if (n < 10) return `$${n.toFixed(2)}`;
    return `$${n.toFixed(1)}`;
  }

  function dayLabel(date: string): string {
    return date.slice(5).replace("-", ".");
  }

  function delegeRengi(oran: number): string {
    if (oran >= 60) return "ok";
    if (oran >= 30) return "warn";
    return "bad";
  }
  function batchRengi(oran: number): string {
    if (oran >= 2.5) return "ok";
    if (oran >= 1.5) return "warn";
    return "bad";
  }

  onMount(async () => {
    try {
      const [u, t] = await Promise.all([
        aggregateUsage(),
        turnMetricsSummary(24).catch(() => null),
      ]);
      all = u;
      turnSum = t;
    } finally {
      loading = false;
    }
  });
</script>

<div class="usage">
  <div class="summary">
    <div class="sum-card arc-card">
      <span class="arc-caption">Today</span>
      <span class="sum-val">{fmt(today())}</span>
      <span class="sum-unit">
        in {fmt(todayIn())} · out {fmt(todayOut())}
      </span>
    </div>
    <div class="sum-card arc-card">
      <span class="arc-caption">{period === 7 ? "Last 7 days" : "Last 30 days"}</span>
      <span class="sum-val">{fmt(periodTotal)}</span>
      <span class="sum-unit">
        in {fmt(periodIn)} · out {fmt(periodOut)}
      </span>
    </div>
    <div class="sum-card arc-card">
      <span class="arc-caption">Daily average</span>
      <span class="sum-val">{fmt(periodAvg)}</span>
      <span class="sum-unit">
        {activeDays}/{period} active days
      </span>
    </div>
    <div class="sum-card arc-card">
      <span class="arc-caption">Est. cost</span>
      <span class="sum-val cost-val">{fmtUsd(periodCost)}</span>
      <span class="sum-unit">~$5/M in + $25/M out</span>
    </div>
  </div>

  {#if turnSum}
    {@const dRate = turnSum.delegation_rate}
    {@const bEff = turnSum.batch_efficiency}
    <div class="metrics">
      <div class="metric-card arc-card metric-{delegeRengi(dRate)}">
        <div class="metric-head">
          <span class="arc-caption">Delegation Rate</span>
          <span class="metric-hedef">target 60%+</span>
        </div>
        <div class="metric-body">
          <span class="metric-val">{dRate.toFixed(0)}<span class="metric-unit">%</span></span>
          <span class="metric-sub">
            {turnSum.delegation_count} / {turnSum.delegation_total} tool · last {turnSum.window_hours}h
          </span>
        </div>
        {#if turnSum.recent.length > 0}
          <div class="spark">
            {#each turnSum.recent as r, ri (`${r.ts}-${ri}`)}
              {@const tot = r.tool_count || 1}
              {@const dPct = ((r.delegate + r.task + r.spawn_worker) / tot) * 100}
              <div class="spark-bar" title={`${new Date(r.ts).toLocaleString()}\n${(r.delegate + r.task + r.spawn_worker)}/${r.tool_count} delegated`}>
                <div class="spark-fill" style:height={`${dPct}%`}></div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      <div class="metric-card arc-card metric-{batchRengi(bEff)}">
        <div class="metric-head">
          <span class="arc-caption">Batch Efficiency</span>
          <span class="metric-hedef">ideal 3-5 · poor &lt;1.5</span>
        </div>
        <div class="metric-body">
          <span class="metric-val">{bEff.toFixed(2)}<span class="metric-unit">x</span></span>
          <span class="metric-sub">
            tool/round avg · {turnSum.batch_turns} turns
          </span>
        </div>
        {#if turnSum.recent.length > 0}
          <div class="spark">
            {#each turnSum.recent as r, ri (`${r.ts}-${ri}`)}
              {@const ratio = r.round_count > 0 ? r.tool_count / r.round_count : 0}
              {@const h = Math.min(100, (ratio / 5) * 100)}
              <div class="spark-bar" title={`${new Date(r.ts).toLocaleString()}\n${r.tool_count} tool / ${r.round_count} round = ${ratio.toFixed(2)}x`}>
                <div class="spark-fill" style:height={`${h}%`}></div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <div class="chart-card arc-card">
    <div class="chart-head">
      <span class="arc-caption">Token consumption</span>
      <div class="period-switch">
        <button class:active={period === 7} onclick={() => (period = 7)}>Week</button>
        <button class:active={period === 30} onclick={() => (period = 30)}>Month</button>
      </div>
    </div>

    {#if loading}
      <p class="muted">Loading…</p>
    {:else}
      <div class="chart-legend">
        <span class="lg-item"><span class="lg-sw lg-in"></span>input</span>
        <span class="lg-item"><span class="lg-sw lg-out"></span>output</span>
        {#if peakDay()}
          <span class="lg-peak">
            peak: {dayLabel(peakDay()!.date)} · {fmt(peakDay()!.input + peakDay()!.output)}
          </span>
        {/if}
      </div>
      <div class="chart" class:dense={period === 30}>
        {#each days as d (d.date)}
          <div class="bar-col" title={`${d.date}\nin ${fmt(d.input)} · out ${fmt(d.output)}`}>
            <div class="bar-track">
              <div class="bar-stack" style:height={`${((d.input + d.output) / maxTotal) * 100}%`}>
                <div
                  class="bar-out"
                  style:height={`${d.input + d.output > 0 ? (d.output / (d.input + d.output)) * 100 : 0}%`}
                ></div>
                <div
                  class="bar-in"
                  style:height={`${d.input + d.output > 0 ? (d.input / (d.input + d.output)) * 100 : 0}%`}
                ></div>
              </div>
            </div>
            <span class="bar-label">{dayLabel(d.date)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .usage {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }
  @media (max-width: 760px) {
    .summary {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .cost-val {
    color: var(--arc-accent, var(--arc-primary-strong));
  }

  .sum-card {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .sum-val {
    font-size: 26px;
    font-weight: 800;
    color: var(--arc-primary-strong);
  }

  .sum-unit {
    font-size: 11px;
    color: var(--arc-text-faint);
  }

  .chart-card {
    padding: 16px;
  }

  .chart-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .period-switch {
    display: flex;
    background: var(--arc-surface-2);
    border: 1px solid var(--arc-border);
    border-radius: 8px;
    overflow: hidden;
  }

  .period-switch button {
    border: none;
    background: transparent;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    color: var(--arc-text-soft);
  }

  .period-switch button.active {
    background: var(--arc-primary);
    color: #fff;
  }

  .chart {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    height: 180px;
  }

  .chart.dense {
    gap: 3px;
  }

  .bar-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    height: 100%;
  }

  .bar-track {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
  }

  .bar-stack {
    width: 100%;
    display: flex;
    flex-direction: column;
    border-radius: 5px 5px 0 0;
    overflow: hidden;
    transition: height 0.2s ease;
  }
  .bar-out {
    background: var(--arc-accent, #f59e0b);
  }
  .bar-in {
    background: var(--arc-primary);
  }

  .chart-legend {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 8px;
    font-size: 10.5px;
    color: var(--arc-text-soft);
  }
  .lg-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .lg-sw {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  .lg-in {
    background: var(--arc-primary);
  }
  .lg-out {
    background: var(--arc-accent, #f59e0b);
  }
  .lg-peak {
    margin-left: auto;
    font-family: var(--arc-mono);
    color: var(--arc-text-faint);
  }

  .bar-label {
    font-size: 9px;
    color: var(--arc-text-faint);
    white-space: nowrap;
  }

  .chart.dense .bar-label {
    display: none;
  }

  .muted {
    color: var(--arc-text-soft);
    font-size: 13px;
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
  @media (max-width: 760px) {
    .metrics {
      grid-template-columns: 1fr;
    }
  }

  .metric-card {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    position: relative;
    overflow: hidden;
    border-top: 3px solid transparent;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .metric-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(15, 118, 110, 0.12);
  }
  .metric-ok { border-top-color: #10b981; }
  .metric-warn { border-top-color: #f59e0b; }
  .metric-bad { border-top-color: #ef4444; }

  .metric-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .metric-hedef {
    font-size: 10px;
    color: var(--arc-text-faint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .metric-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .metric-val {
    font-size: 30px;
    font-weight: 800;
    line-height: 1;
    color: var(--arc-primary-strong);
    font-variant-numeric: tabular-nums;
  }
  .metric-ok .metric-val { color: #059669; }
  .metric-warn .metric-val { color: #d97706; }
  .metric-bad .metric-val { color: #dc2626; }
  .metric-unit {
    font-size: 16px;
    font-weight: 600;
    margin-left: 2px;
    opacity: 0.7;
  }
  .metric-sub {
    font-size: 11px;
    color: var(--arc-text-soft);
  }
  .spark {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 28px;
    margin-top: 4px;
  }
  .spark-bar {
    flex: 1;
    height: 100%;
    background: var(--arc-surface-2);
    border-radius: 2px;
    display: flex;
    align-items: flex-end;
    overflow: hidden;
  }
  .spark-fill {
    width: 100%;
    background: currentColor;
    opacity: 0.55;
    transition: height 0.2s ease;
  }
  .metric-ok .spark-fill { background: #10b981; }
  .metric-warn .spark-fill { background: #f59e0b; }
  .metric-bad .spark-fill { background: #ef4444; }
</style>
