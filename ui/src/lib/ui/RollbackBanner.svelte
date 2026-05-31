<script lang="ts">
  import Icon from "$lib/icons/Icon.svelte";
  import type { AutoRollbackInfo } from "$lib/store.svelte";

  let {
    info,
    dismissedTs = 0,
    onDismiss,
  }: {
    info: AutoRollbackInfo | null;
    dismissedTs?: number;
    onDismiss: () => void;
  } = $props();

  const visible = $derived(!!info && info.ts > dismissedTs);
  const tone = $derived(info?.status === "ok" ? "warn" : "danger");
  const title = $derived(
    info?.status === "ok"
      ? `Automatic rollback: ${info.oldHash.slice(0, 8)} → ${info.newHash.slice(0, 8)}`
      : info?.status === "skipped_same_hash"
        ? "Rollback skipped — manual intervention required"
        : "Rollback failed",
  );
  const sebep = $derived(info?.trigger?.reason ?? "");
  const kategori = $derived(info?.trigger?.category ?? "");
  const detail = $derived(info?.detail ?? "");
</script>

{#if visible && info}
  <div class="rb" class:danger={tone === "danger"} role="alert">
    <div class="rb-icon" aria-hidden="true">
      <!-- Decorative icon: 'alert' in every tone — so the user does not mistake the
           'x' icon for the close button. Closing is only the right X button (rb-close). -->
      <Icon name="alert" size={16} stroke={2.4} />
    </div>
    <div class="rb-body">
      <div class="rb-title">{title}</div>
      <div class="rb-meta">
        <span class="rb-cat">{kategori}</span>
        <span class="rb-sep">·</span>
        <span class="rb-sebep">{sebep}</span>
      </div>
      {#if detail}
        <div class="rb-detail">{detail}</div>
      {/if}
    </div>
    <button type="button" class="rb-close" onclick={onDismiss} title="Close" aria-label="Close">
      <Icon name="x" size={13} stroke={2.4} />
    </button>
  </div>
{/if}

<style>
  .rb {
    flex-shrink: 0;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin: 10px 20px 0;
    padding: 11px 14px;
    border: 1px solid #f59e0b;
    border-left: 3px solid #f59e0b;
    border-radius: var(--arc-r-sm);
    background: color-mix(in srgb, #f59e0b 8%, var(--arc-surface));
    box-shadow: 0 1px 3px rgba(245, 158, 11, 0.12);
    animation: rb-in 0.18s var(--arc-ease);
  }
  .rb.danger {
    border-color: var(--arc-danger);
    border-left-color: var(--arc-danger);
    background: color-mix(in srgb, var(--arc-danger) 8%, var(--arc-surface));
    box-shadow: 0 1px 3px rgba(220, 38, 38, 0.14);
  }
  @keyframes rb-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .rb-icon {
    color: #b45309;
    margin-top: 1px;
    flex-shrink: 0;
  }
  .rb.danger .rb-icon {
    color: var(--arc-danger);
  }
  .rb-body {
    flex: 1;
    min-width: 0;
  }
  .rb-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--arc-text);
    margin-bottom: 2px;
  }
  .rb-meta {
    font-size: 11.5px;
    color: var(--arc-text-soft);
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .rb-cat {
    font-family: var(--arc-mono);
    background: rgba(245, 158, 11, 0.16);
    color: #92400e;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10.5px;
    font-weight: 500;
  }
  .rb.danger .rb-cat {
    background: rgba(220, 38, 38, 0.16);
    color: #991b1b;
  }
  .rb-sep {
    color: var(--arc-text-faint);
  }
  .rb-sebep {
    word-break: break-word;
  }
  .rb-detail {
    margin-top: 4px;
    font-size: 11.5px;
    color: var(--arc-text-soft);
    line-height: 1.45;
  }
  .rb-close {
    flex-shrink: 0;
    padding: 4px;
    border: none;
    background: transparent;
    color: var(--arc-text-faint);
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.13s, color 0.13s;
  }
  .rb-close:hover {
    background: rgba(0, 0, 0, 0.06);
    color: var(--arc-text);
  }
</style>
