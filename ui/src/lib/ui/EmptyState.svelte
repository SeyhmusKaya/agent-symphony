<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import type { IconName } from "$lib/icons/paths";

  let {
    icon = "sparkles",
    title,
    text,
    compact = false,
    children,
  }: {
    icon?: IconName;
    title?: string;
    text?: string;
    compact?: boolean;
    children?: Snippet;
  } = $props();
</script>

<div class="empty" class:compact>
  <div class="empty-icon">
    <Icon name={icon} size={compact ? 18 : 24} stroke={1.6} />
  </div>
  {#if title}<div class="empty-title">{title}</div>{/if}
  {#if text}<p class="empty-text">{text}</p>{/if}
  {#if children}
    <div class="empty-action">{@render children()}</div>
  {/if}
</div>

<style>
  .empty {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
    padding: 36px 20px;
    max-width: 340px;
  }
  .empty.compact {
    padding: 22px 14px;
    gap: 6px;
  }
  .empty-icon {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: var(--arc-r);
    background: var(--arc-primary-tint);
    border: 1px solid var(--arc-primary-soft);
    color: var(--arc-primary);
  }
  .empty.compact .empty-icon {
    width: 38px;
    height: 38px;
  }
  .empty-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--arc-text);
  }
  .empty-text {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--arc-text-faint);
  }
  .empty-action {
    margin-top: 4px;
  }
</style>
