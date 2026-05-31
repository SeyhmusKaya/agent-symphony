<script lang="ts">
  // Series of temporary workers at the bottom of the project screen. Parent:
  // passes workers[] + the expanded id state and a setter callback.
  import Icon from "$lib/icons/Icon.svelte";
  import type { WorkerView } from "$lib/store.svelte";

  interface Props {
    workers: WorkerView[];
    expandedWorker: number | null;
    onToggle: (id: number | null) => void;
  }
  let { workers, expandedWorker, onToggle }: Props = $props();

  const liveWorkers = $derived(workers.filter((w) => !w.done));
  const detail = $derived(
    expandedWorker !== null ? workers.find((x) => x.id === expandedWorker) : null,
  );
</script>

{#if liveWorkers.length > 0 || expandedWorker !== null}
  <footer class="worker-strip">
    <div class="worker-strip-head">
      <Icon name="sparkles" size={13} class="panel-head-ic" />
      <span class="arc-caption">Temporary workers</span>
    </div>
    <div class="worker-chips">
      {#each workers as w (w.id)}
        {#if !w.done || expandedWorker === w.id}
          <button
            class="worker-chip"
            class:done={w.done}
            class:err={w.isError}
            onclick={() => onToggle(expandedWorker === w.id ? null : w.id)}
          >
            {#if w.done}
              <Icon name={w.isError ? "x" : "check"} size={12} stroke={2.4} />
            {:else}
              <Icon name="loader" size={12} stroke={2.4} spin />
            {/if}
            <span class="worker-task">{w.task}</span>
          </button>
        {/if}
      {/each}
    </div>
    {#if detail}
      <div class="worker-detail">
        <div class="worker-detail-task">{detail.task}</div>
        {#if detail.transcript}
          <pre class="worker-detail-tr">{detail.transcript}</pre>
        {/if}
      </div>
    {/if}
  </footer>
{/if}

<style>
  .worker-strip {
    flex-shrink: 0;
    border-top: 1px solid var(--arc-border);
    background: var(--arc-surface);
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .worker-strip-head {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .worker-strip :global(.panel-head-ic) {
    color: var(--arc-primary);
  }
  .worker-chips {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
  }
  .worker-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--arc-border);
    background: var(--arc-surface-2);
    border-radius: var(--arc-r-pill);
    padding: 5px 12px;
    font-size: 11px;
    color: var(--arc-text-soft);
    max-width: 240px;
    transition: border-color 0.15s var(--arc-ease);
  }
  .worker-chip :global(svg) {
    color: var(--arc-accent);
    flex-shrink: 0;
  }
  .worker-chip:hover {
    border-color: var(--arc-primary);
  }
  .worker-chip.done {
    opacity: 0.6;
  }
  .worker-chip.done :global(svg) {
    color: var(--arc-ok);
  }
  .worker-chip.err {
    border-color: var(--arc-danger);
    color: var(--arc-danger);
  }
  .worker-chip.err :global(svg) {
    color: var(--arc-danger);
  }
  .worker-task {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .worker-detail {
    font-size: 11px;
    color: var(--arc-text-soft);
    background: var(--arc-surface-2);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    padding: 8px 10px;
    max-width: 380px;
  }
  .worker-detail-task {
    font-weight: 600;
    color: var(--arc-text);
  }
  .worker-detail-tr {
    margin: 6px 0 0;
    font-family: var(--arc-mono);
    font-size: 10px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow: auto;
  }
</style>
