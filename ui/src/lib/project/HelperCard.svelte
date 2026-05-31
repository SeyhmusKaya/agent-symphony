<script lang="ts">
  // Left-panel "Workers" card — a temporary helper agent produced by the chief
  // (native Agent subagent OR a `task` worker). Data: ProjectSession.helpers
  // (derived from chat segments + canliAktivite). Clicking opens detail+result.
  import Icon from "$lib/icons/Icon.svelte";
  import Badge from "$lib/ui/Badge.svelte";
  import type { HelperView } from "$lib/store.svelte";

  interface Props {
    helper: HelperView;
    expanded: boolean;
    onToggle: () => void;
    // now, ticking every second (session.nowTick) — elapsed indicator for a running helper.
    now?: number;
  }
  let { helper, expanded, onToggle, now = Date.now() }: Props = $props();

  const isRunning = $derived(helper.status === "running");
  const isErr = $derived(helper.status === "error");
  const kindLabel = $derived(helper.kind === "agent" ? "Subagent" : "Task");
  const usd = $derived(helper.tokens?.usd);
  // Elapsed time: while running, now-startTs is live; it does not freeze when done
  // (no end stamp) — shown only while running. mm:ss format.
  const elapsedLabel = $derived.by(() => {
    if (!isRunning || !helper.startTs) return "";
    const sec = Math.max(0, Math.floor((now - helper.startTs) / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  });
</script>

<div
  class="helper-card"
  class:running={isRunning}
  class:err={isErr}
  role="button"
  tabindex="0"
  onclick={onToggle}
  onkeydown={(e) => (e.key === "Enter" || e.key === " ") && onToggle()}
  aria-expanded={expanded}
>
  <div class="hc-top">
    <span class="hc-dot" class:busy={isRunning} class:errdot={isErr}>
      {#if isRunning}
        <Icon name="loader" size={11} stroke={2.4} spin />
      {:else if isErr}
        <Icon name="x" size={11} stroke={2.6} />
      {:else}
        <Icon name="check" size={11} stroke={2.6} />
      {/if}
    </span>
    <div class="hc-id">
      <div class="hc-name">{helper.label}</div>
      <div class="hc-kind">{kindLabel}</div>
    </div>
    {#if elapsedLabel}
      <span class="hc-elapsed" title="Running time">{elapsedLabel}</span>
    {/if}
    <span class="hc-chev-wrap" class:open={expanded}>
      <Icon name="chevronDown" size={14} class="hc-chev" />
    </span>
  </div>

  <div class="hc-meta">
    {#if helper.kind === "agent"}
      <Badge variant="soft" tone="primary">specialist</Badge>
    {:else}
      <Badge variant="soft" tone="neutral">task</Badge>
    {/if}
    {#if helper.model}
      <Badge variant="outline" mono>{helper.model}</Badge>
    {/if}
    {#if usd != null}
      <Badge variant="soft" tone="ok" mono>${usd.toFixed(3)}</Badge>
    {/if}
  </div>

  {#if isRunning && helper.progress}
    <div class="hc-progress">{helper.progress}</div>
  {/if}

  {#if expanded}
    <div class="hc-detail">
      {#if helper.detail}
        <div class="hc-detail-label">Task</div>
        <div class="hc-detail-text">{helper.detail}</div>
      {/if}
      {#if helper.result}
        <div class="hc-detail-label">Result</div>
        <pre class="hc-detail-pre">{helper.result}</pre>
      {:else if isRunning}
        <div class="hc-detail-text muted">Running…</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .helper-card {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: 9px;
    box-shadow: var(--arc-shadow-sm);
    /* Compact — there can be many tasks, small rectangles. */
    padding: 6px 9px;
    cursor: pointer;
    transition:
      transform 0.15s var(--arc-ease),
      box-shadow 0.15s var(--arc-ease),
      border-color 0.15s var(--arc-ease);
  }
  .helper-card:hover {
    transform: translateY(-1px);
    box-shadow: var(--arc-shadow-teal);
    border-color: var(--arc-primary);
  }
  .helper-card.running {
    border-color: var(--arc-accent);
  }
  .helper-card.err {
    border-color: var(--arc-danger);
  }
  .hc-top {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .hc-dot {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: color-mix(in srgb, var(--arc-ok, #16a34a) 14%, transparent);
    color: var(--arc-ok, #16a34a);
  }
  .hc-dot.busy {
    background: color-mix(in srgb, #f59e0b 16%, transparent);
    color: #f59e0b;
  }
  .hc-dot.errdot {
    background: color-mix(in srgb, var(--arc-danger) 16%, transparent);
    color: var(--arc-danger);
  }
  .hc-id {
    flex: 1;
    min-width: 0;
  }
  .hc-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--arc-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hc-kind {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--arc-text-soft);
  }
  .hc-elapsed {
    flex-shrink: 0;
    font-size: 10.5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #f59e0b;
    background: color-mix(in srgb, #f59e0b 13%, transparent);
    border-radius: 6px;
    padding: 1px 6px;
  }
  .hc-chev-wrap {
    display: flex;
    flex-shrink: 0;
    color: var(--arc-text-soft);
    transition: transform 0.18s var(--arc-ease);
  }
  .hc-chev-wrap.open {
    transform: rotate(180deg);
  }
  .helper-card :global(.hc-chev) {
    color: var(--arc-text-soft);
  }
  .hc-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }
  .hc-progress {
    margin-top: 8px;
    font-size: 11px;
    color: var(--arc-text-soft);
    font-style: italic;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hc-detail {
    margin-top: 10px;
    border-top: 1px solid var(--arc-border);
    padding-top: 9px;
  }
  .hc-detail-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--arc-text-soft);
    font-weight: 600;
    margin-bottom: 3px;
  }
  .hc-detail-label:not(:first-child) {
    margin-top: 9px;
  }
  .hc-detail-text {
    font-size: 11.5px;
    color: var(--arc-text);
    line-height: 1.5;
    word-break: break-word;
  }
  .hc-detail-text.muted {
    color: var(--arc-text-soft);
    font-style: italic;
  }
  .hc-detail-pre {
    margin: 0;
    font-family: var(--arc-mono);
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--arc-text-soft);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 220px;
    overflow: auto;
  }
</style>
