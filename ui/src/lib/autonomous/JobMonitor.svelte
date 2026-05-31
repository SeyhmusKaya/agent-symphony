<script lang="ts">
  // ui/src/lib/autonomous/JobMonitor.svelte — F3 Autonomous Jobs Panel.
  //
  // The UI side of master plan section "F3: Autonomous 3-Day Mode". When the
  // chief starts a multi-day task, the backend AutonomousManager sends the job
  // list inside the status payload. This component:
  //   - Shows a corporate CTA in the empty state ("tell the chief 'task, run for 3 days'").
  //   - Each job card: day line + progress bar + commit/file/$/turn badges.
  //   - Pause/Resume/Cancel buttons — onPause/onResume/onCancel callbacks.
  //   - Hover lift + teal gradient header — CLAUDE.md corporate design rule.
  //
  // Data source: ProjectStatus.autonomousJobs[] (types.ts AutonomousJob).
  // Actions go to the backend over WS via the otonom* methods in
  // projectSession.svelte.ts.

  import type { AutonomousJob } from "$lib/store/types";

  let {
    jobs = [],
    onPause,
    onResume,
    onCancel,
  }: {
    jobs?: AutonomousJob[];
    onPause: (jobId: string) => void;
    onResume: (jobId: string) => void;
    onCancel: (jobId: string) => void;
  } = $props();

  // Active ones on top, completed below — active items catch the eye first in the UI.
  const sirali = $derived(
    [...jobs].sort((a, b) => {
      const aActive = a.status === "running" || a.status === "paused" ? 0 : 1;
      const bActive = b.status === "running" || b.status === "paused" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return b.startedAt - a.startedAt;
    }),
  );

  function elapsedHours(j: AutonomousJob): number {
    const end = j.finishedAt ?? Date.now();
    return Math.max(0, (end - j.startedAt) / (3600 * 1000));
  }

  function percentDone(j: AutonomousJob): number {
    const cap = j.maxDays * 24;
    if (cap <= 0) return 0;
    return Math.min(100, (elapsedHours(j) / cap) * 100);
  }

  function fmtSaat(h: number): string {
    if (h < 1) return `${Math.round(h * 60)}m`;
    if (h < 24) return `${h.toFixed(1)}h`;
    const d = Math.floor(h / 24);
    const r = h - d * 24;
    return r >= 0.5 ? `${d}d ${Math.round(r)}h` : `${d}d`;
  }

  function fmtUsd(n: number): string {
    return `$${n.toFixed(2)}`;
  }

  function statusLabel(s: AutonomousJob["status"]): string {
    return {
      running: "Running",
      paused: "Paused",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
    }[s];
  }

  function statusClass(s: AutonomousJob["status"]): string {
    return `pill pill-${s}`;
  }

  function aktif(j: AutonomousJob): boolean {
    return j.status === "running" || j.status === "paused";
  }
</script>

<section class="auto-panel" aria-label="Autonomous jobs">
  <header class="auto-head">
    <div class="auto-head-title">
      <span class="auto-caption">F3</span>
      <h3>Autonomous Jobs</h3>
    </div>
    <span class="auto-count">{sirali.length}</span>
  </header>

  {#if sirali.length === 0}
    <div class="auto-empty">
      <div class="auto-empty-icon" aria-hidden="true">·</div>
      <p class="auto-empty-baslik">No autonomous jobs yet</p>
      <p class="auto-empty-not">
        Tell the chief <code>"rewrite the Volpora checkout page from scratch, run for 3 days"</code>;
        it starts automatically, commits periodically, and returns a summary when done.
      </p>
    </div>
  {:else}
    <ul class="auto-list">
      {#each sirali as job (job.id)}
        <li class="auto-card" class:bitti={!aktif(job)}>
          <div class="auto-card-top">
            <div class="auto-task" title={job.task}>{job.task}</div>
            <span class={statusClass(job.status)}>{statusLabel(job.status)}</span>
          </div>

          <div class="auto-row-meta">
            <span class="meta-key">Duration</span>
            <span class="meta-val">{fmtSaat(elapsedHours(job))} / {job.maxDays}d</span>
            <span class="meta-sep">·</span>
            <span class="meta-key">Turns</span>
            <span class="meta-val">{job.turnsTotal}</span>
          </div>

          <div class="auto-bar" aria-hidden="true">
            <div
              class="auto-bar-fill"
              class:running={job.status === "running"}
              class:paused={job.status === "paused"}
              style="width: {percentDone(job)}%"
            ></div>
          </div>

          <div class="auto-stats">
            <div class="stat">
              <span class="stat-cap">Commits</span>
              <span class="stat-val">{job.commitsMade}</span>
            </div>
            <div class="stat">
              <span class="stat-cap">Files</span>
              <span class="stat-val">{job.filesChangedTotal}</span>
            </div>
            <div class="stat">
              <span class="stat-cap">Cost</span>
              <span class="stat-val">{fmtUsd(job.costUsdTotal)}</span>
            </div>
          </div>

          {#if job.failReason}
            <p class="auto-err">{job.failReason}</p>
          {/if}

          <div class="auto-actions">
            {#if job.status === "running"}
              <button class="btn btn-soft" onclick={() => onPause(job.id)}>Pause</button>
              <button class="btn btn-danger" onclick={() => onCancel(job.id)}>Cancel</button>
            {:else if job.status === "paused"}
              <button class="btn btn-primary" onclick={() => onResume(job.id)}>Resume</button>
              <button class="btn btn-danger" onclick={() => onCancel(job.id)}>Cancel</button>
            {:else}
              <span class="auto-finished">{statusLabel(job.status)}</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  /* CLAUDE.md corporate rule — teal gradient header, soft shadow, hover lift. */
  .auto-panel {
    --ev-primary: #0f766e;
    --ev-primary-soft: #ccfbf1;
    --ev-text: #0f172a;
    --ev-text-soft: #475569;
    --ev-border: #e2e8f0;
    --ev-surface: #ffffff;
    --ev-surface-soft: #f8fafc;
    --ev-danger: #b91c1c;
    --ev-success: #047857;
    --ev-warn: #b45309;
    border-radius: 14px;
    background: var(--ev-surface);
    border: 1px solid var(--ev-border);
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    overflow: hidden;
    font-family: inherit;
    color: var(--ev-text);
  }
  .auto-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%);
    color: #fff;
  }
  .auto-head-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .auto-caption {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    opacity: 0.78;
  }
  .auto-head h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .auto-count {
    background: rgba(255, 255, 255, 0.22);
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 12px;
    font-weight: 600;
  }

  .auto-empty {
    padding: 28px 20px;
    text-align: center;
    background: var(--ev-surface-soft);
  }
  .auto-empty-icon {
    font-size: 28px;
    color: var(--ev-primary);
    margin-bottom: 4px;
  }
  .auto-empty-baslik {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ev-text);
  }
  .auto-empty-not {
    margin: 0;
    font-size: 12px;
    line-height: 1.55;
    color: var(--ev-text-soft);
  }
  .auto-empty-not code {
    background: #fff;
    border: 1px solid var(--ev-border);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 11px;
    color: var(--ev-text);
  }

  .auto-list {
    list-style: none;
    margin: 0;
    padding: 8px;
    display: grid;
    gap: 10px;
  }

  .auto-card {
    background: var(--ev-surface);
    border: 1px solid var(--ev-border);
    border-radius: 12px;
    padding: 12px 14px;
    display: grid;
    gap: 8px;
    transition: transform 140ms ease, box-shadow 140ms ease;
  }
  .auto-card:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.1);
  }
  .auto-card.bitti {
    opacity: 0.72;
  }

  .auto-card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }
  .auto-task {
    font-size: 13px;
    font-weight: 600;
    color: var(--ev-text);
    line-height: 1.4;
    flex: 1;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .pill-running {
    background: var(--ev-primary-soft);
    color: var(--ev-primary);
  }
  .pill-paused {
    background: #fef3c7;
    color: var(--ev-warn);
  }
  .pill-completed {
    background: #d1fae5;
    color: var(--ev-success);
  }
  .pill-failed {
    background: #fee2e2;
    color: var(--ev-danger);
  }
  .pill-cancelled {
    background: #e2e8f0;
    color: var(--ev-text-soft);
  }

  .auto-row-meta {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 11px;
    color: var(--ev-text-soft);
  }
  .meta-key {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #94a3b8;
  }
  .meta-val {
    font-size: 12px;
    font-weight: 600;
    color: var(--ev-text);
  }
  .meta-sep {
    color: #cbd5e1;
  }

  .auto-bar {
    width: 100%;
    height: 6px;
    background: var(--ev-surface-soft);
    border-radius: 999px;
    overflow: hidden;
  }
  .auto-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #0f766e 0%, #14b8a6 100%);
    transition: width 220ms ease;
  }
  .auto-bar-fill.paused {
    background: linear-gradient(90deg, #b45309 0%, #f59e0b 100%);
  }

  .auto-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--ev-surface-soft);
    border-radius: 8px;
    padding: 6px 8px;
  }
  .stat-cap {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #94a3b8;
  }
  .stat-val {
    font-size: 13px;
    font-weight: 700;
    color: var(--ev-text);
  }

  .auto-err {
    margin: 0;
    padding: 6px 8px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    font-size: 11px;
    color: var(--ev-danger);
    line-height: 1.45;
  }

  .auto-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: flex-end;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    border: 0;
    border-radius: 8px;
    padding: 5px 12px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 120ms ease, transform 120ms ease;
  }
  .btn:hover {
    transform: translateY(-1px);
  }
  .btn-primary {
    background: var(--ev-primary);
    color: #fff;
  }
  .btn-primary:hover {
    background: #0d6962;
  }
  .btn-soft {
    background: var(--ev-primary-soft);
    color: var(--ev-primary);
  }
  .btn-soft:hover {
    background: #b5f0e3;
  }
  .btn-danger {
    background: #fee2e2;
    color: var(--ev-danger);
  }
  .btn-danger:hover {
    background: #fecaca;
  }

  .auto-finished {
    font-size: 11px;
    color: var(--ev-text-soft);
    font-style: italic;
  }
</style>
