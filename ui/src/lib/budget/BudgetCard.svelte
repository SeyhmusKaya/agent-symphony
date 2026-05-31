<script lang="ts">
  // F4 (Cost Control): BudgetCard — daily budget gauge + cap edit + hourly
  // burn badge + top-3 spender list. Integrated into ChiefToolbar as a dropdown
  // or inline component.
  //
  // Design: teal gradient header, rounded card surface, hover-lift, corporate
  // typography (uppercase caption + bold value). CLAUDE.md design rule.
  //
  // Gauge color stops:
  //   <50%   green  (healthy)
  //   50-80% amber  (caution)
  //   >80%   red    (dropped to / may drop to auto-fallback)
  //
  // Cap edit: a small pencil icon opens an inline editor; setBudgetCap(role, USD)
  // goes to the backend over WS, status refreshes the UI live via pushStatus.

  import type { BudgetReport } from "$lib/store/types";
  import type { ProjectSession } from "$lib/store/projectSession.svelte";

  interface Props {
    budgets: BudgetReport | null;
    sessionUsd: number;
    hourlyUsd: number;
    session: ProjectSession;
    selfRole?: "chief" | "mimar" | "specialist" | "advisor" | "worker";
  }

  const { budgets, sessionUsd, hourlyUsd, session, selfRole = "chief" }: Props = $props();

  // Self agent name — the backend records spend with projectName; it shows up
  // in topSpenders under the same name. Cap display + edit is primarily this role's cap.
  const selfStatus = $derived.by(() => {
    if (!budgets) return null;
    const cap =
      selfRole === "chief"
        ? budgets.config.perChiefDailyUsd
        : selfRole === "mimar"
          ? budgets.config.perMimarDailyUsd
          : budgets.config.perAgentDailyUsd;
    // Find the self name in topSpenders; fall back to 0 if absent.
    const self = budgets.agents[0];
    const usd = self?.usd ?? 0;
    const pct = cap > 0 ? Math.min(usd / cap, 1.5) : 0;
    return { usd, cap, pct, agent: self?.agent ?? "(no spend today)" };
  });

  const pctInt = $derived(
    selfStatus ? Math.round(selfStatus.pct * 100) : 0,
  );
  const tone = $derived(pctInt >= 80 ? "red" : pctInt >= 50 ? "amber" : "ok");

  // Gauge SVG (circular progress).
  const R = 28;
  const CIRC = 2 * Math.PI * R;
  const dash = $derived(Math.min(1, selfStatus?.pct ?? 0) * CIRC);

  // Cap edit state.
  let editing = $state(false);
  let editValue = $state("");

  function startEdit() {
    editing = true;
    editValue = String(selfStatus?.cap ?? 0);
  }

  function commitEdit() {
    const n = Number(editValue);
    if (Number.isFinite(n) && n >= 0) {
      session.setBudgetCap(selfRole, n);
    }
    editing = false;
  }

  function cancelEdit() {
    editing = false;
  }

  function fmtUsd(n: number): string {
    if (n < 0.005) return "$0.00";
    if (n < 1) return `$${n.toFixed(3)}`;
    if (n < 100) return `$${n.toFixed(2)}`;
    return `$${Math.round(n)}`;
  }

  const top3 = $derived(budgets?.topSpenders.slice(0, 3) ?? []);
</script>

<div class="bc">
  <div class="bc-head">
    <span class="bc-cap">Today</span>
    <span class="bc-title">Budget</span>
    {#if budgets?.hourlyAlarm}
      <span class="bc-alarm" title="Hourly spend threshold exceeded">●</span>
    {/if}
  </div>

  <div class="bc-gauge-row">
    <div class="bc-gauge" data-tone={tone}>
      <svg viewBox="0 0 64 64" width="64" height="64">
        <circle class="bc-track" cx="32" cy="32" r={R} />
        <circle
          class="bc-prog"
          cx="32"
          cy="32"
          r={R}
          stroke-dasharray="{dash} {CIRC}"
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="36" text-anchor="middle" class="bc-pct">{pctInt}%</text>
      </svg>
    </div>

    <div class="bc-stat">
      <div class="bc-row">
        <span class="bc-label">Spent</span>
        <strong class="bc-value">{fmtUsd(selfStatus?.usd ?? 0)}</strong>
      </div>
      <div class="bc-row">
        <span class="bc-label">Cap</span>
        {#if editing}
          <span class="bc-edit">
            <span class="bc-edit-dollar">$</span>
            <input
              class="bc-input"
              type="number"
              min="0"
              step="0.5"
              bind:value={editValue}
              onkeydown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") cancelEdit();
              }}
            />
            <button class="bc-ok" onclick={commitEdit} aria-label="save">✓</button>
            <button class="bc-x" onclick={cancelEdit} aria-label="cancel">×</button>
          </span>
        {:else}
          <span class="bc-cap-row">
            <strong class="bc-value">{fmtUsd(selfStatus?.cap ?? 0)}</strong>
            <button class="bc-pen" onclick={startEdit} title="Edit cap">✎</button>
          </span>
        {/if}
      </div>
      <div class="bc-row">
        <span class="bc-label">Session</span>
        <span class="bc-value-soft">{fmtUsd(sessionUsd)}</span>
      </div>
    </div>
  </div>

  <div class="bc-mini" data-tone={budgets?.hourlyAlarm ? "red" : hourlyUsd > 1 ? "amber" : "ok"}>
    <span class="bc-mini-label">Hourly</span>
    <span class="bc-mini-bar">
      <span
        class="bc-mini-fill"
        style="width: {budgets ? Math.min(100, (hourlyUsd / Math.max(0.01, budgets.config.hourlyBurnAlarmUsd)) * 100) : 0}%"
      ></span>
    </span>
    <span class="bc-mini-value">{fmtUsd(hourlyUsd)}/h</span>
  </div>

  {#if top3.length > 0}
    <div class="bc-top">
      <span class="bc-cap">Top spender</span>
      <ul class="bc-list">
        {#each top3 as s (s.agent)}
          <li class="bc-item">
            <span class="bc-item-name" title={s.agent}>{s.agent}</span>
            <span class="bc-item-bar">
              <span
                class="bc-item-fill"
                data-tone={s.pctUsed >= 0.8 ? "red" : s.pctUsed >= 0.5 ? "amber" : "ok"}
                style="width: {Math.min(100, s.pctUsed * 100)}%"
              ></span>
            </span>
            <span class="bc-item-val">{fmtUsd(s.usd)}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .bc {
    width: 280px;
    border-radius: 14px;
    background: linear-gradient(180deg, var(--arc-surface, #fff) 0%, var(--arc-surface-2, #f7fafa) 100%);
    border: 1px solid var(--arc-border, #e2e8f0);
    box-shadow: 0 1px 2px rgba(15, 118, 110, 0.04), 0 4px 12px rgba(15, 118, 110, 0.06);
    overflow: hidden;
    transition: transform 0.18s var(--arc-ease, ease), box-shadow 0.18s var(--arc-ease, ease);
  }
  .bc:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(15, 118, 110, 0.06), 0 8px 20px rgba(15, 118, 110, 0.1);
  }

  .bc-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 10px 14px;
    color: #fff;
    background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%);
  }
  .bc-cap {
    font-size: 9.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.75);
  }
  .bc-title {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .bc-alarm {
    margin-left: auto;
    color: #fef08a;
    font-size: 16px;
    line-height: 1;
    animation: pulse 1.6s var(--arc-ease, ease) infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.7; }
    50% { opacity: 1; }
  }

  .bc-gauge-row {
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 14px;
  }
  .bc-gauge {
    flex: none;
  }
  .bc-track {
    fill: none;
    stroke: var(--arc-n200, #e5e7eb);
    stroke-width: 6;
  }
  .bc-prog {
    fill: none;
    stroke: #14b8a6;
    stroke-width: 6;
    stroke-linecap: round;
    transition: stroke-dasharray 0.4s var(--arc-ease, ease), stroke 0.2s ease;
  }
  .bc-gauge[data-tone="amber"] .bc-prog { stroke: #d97706; }
  .bc-gauge[data-tone="red"]   .bc-prog { stroke: #dc2626; }
  .bc-pct {
    font-family: var(--arc-mono, monospace);
    font-size: 14px;
    font-weight: 700;
    fill: var(--arc-text, #1f2937);
  }
  .bc-gauge[data-tone="amber"] .bc-pct { fill: #b45309; }
  .bc-gauge[data-tone="red"]   .bc-pct { fill: #b91c1c; }

  .bc-stat {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .bc-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .bc-label {
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--arc-text-soft, #6b7280);
    font-weight: 600;
  }
  .bc-value {
    font-family: var(--arc-mono, monospace);
    font-size: 13px;
    font-weight: 700;
    color: var(--arc-text, #1f2937);
  }
  .bc-value-soft {
    font-family: var(--arc-mono, monospace);
    font-size: 12px;
    color: var(--arc-text-soft, #6b7280);
  }

  .bc-cap-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .bc-pen {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    width: 20px;
    height: 20px;
    cursor: pointer;
    font-size: 11px;
    color: var(--arc-text-soft, #6b7280);
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .bc-pen:hover {
    background: color-mix(in srgb, #14b8a6 12%, transparent);
    color: #0f766e;
    border-color: color-mix(in srgb, #14b8a6 30%, transparent);
  }

  .bc-edit {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .bc-edit-dollar {
    font-family: var(--arc-mono, monospace);
    color: var(--arc-text-soft, #6b7280);
    font-size: 12px;
  }
  .bc-input {
    width: 56px;
    border: 1px solid var(--arc-border, #d1d5db);
    border-radius: 6px;
    padding: 2px 6px;
    font-family: var(--arc-mono, monospace);
    font-size: 12px;
    background: var(--arc-surface, #fff);
    color: var(--arc-text, #1f2937);
  }
  .bc-input:focus {
    outline: none;
    border-color: #0f766e;
    box-shadow: 0 0 0 2px color-mix(in srgb, #14b8a6 20%, transparent);
  }
  .bc-ok, .bc-x {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 1px solid transparent;
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
  }
  .bc-ok {
    background: color-mix(in srgb, #14b8a6 18%, transparent);
    color: #0f766e;
  }
  .bc-x {
    background: transparent;
    color: var(--arc-text-soft, #6b7280);
  }

  .bc-mini {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-top: 1px solid var(--arc-border, #e2e8f0);
    background: var(--arc-surface-2, #f7fafa);
  }
  .bc-mini-label {
    font-size: 9.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--arc-text-soft, #6b7280);
    width: 50px;
    flex: none;
  }
  .bc-mini-bar {
    position: relative;
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: var(--arc-n200, #e5e7eb);
    overflow: hidden;
  }
  .bc-mini-fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 999px;
    background: #14b8a6;
    transition: width 0.3s var(--arc-ease, ease), background 0.2s ease;
  }
  .bc-mini[data-tone="amber"] .bc-mini-fill { background: #d97706; }
  .bc-mini[data-tone="red"]   .bc-mini-fill { background: #dc2626; }
  .bc-mini-value {
    font-family: var(--arc-mono, monospace);
    font-size: 11px;
    color: var(--arc-text, #1f2937);
    font-weight: 600;
    min-width: 60px;
    text-align: right;
  }

  .bc-top {
    padding: 10px 14px 12px;
    border-top: 1px solid var(--arc-border, #e2e8f0);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bc-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bc-item {
    display: grid;
    grid-template-columns: 1fr 70px 50px;
    gap: 8px;
    align-items: center;
  }
  .bc-item-name {
    font-size: 11.5px;
    font-weight: 500;
    color: var(--arc-text, #1f2937);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bc-item-bar {
    position: relative;
    height: 4px;
    border-radius: 999px;
    background: var(--arc-n200, #e5e7eb);
    overflow: hidden;
  }
  .bc-item-fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 999px;
    background: #14b8a6;
    transition: width 0.3s var(--arc-ease, ease);
  }
  .bc-item-fill[data-tone="amber"] { background: #d97706; }
  .bc-item-fill[data-tone="red"]   { background: #dc2626; }
  .bc-item-val {
    font-family: var(--arc-mono, monospace);
    font-size: 11px;
    color: var(--arc-text-soft, #6b7280);
    text-align: right;
    font-weight: 600;
  }
</style>
