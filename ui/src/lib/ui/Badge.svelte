<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import type { IconName } from "$lib/icons/paths";

  let {
    variant = "soft",
    tone = "neutral",
    icon,
    dot = false,
    pulse = false,
    mono = false,
    children,
  }: {
    variant?: "solid" | "soft" | "outline";
    tone?: "primary" | "ok" | "warn" | "danger" | "info" | "neutral";
    icon?: IconName;
    dot?: boolean;
    pulse?: boolean;
    mono?: boolean;
    children?: Snippet;
  } = $props();
</script>

<span class="badge" class:mono data-variant={variant} data-tone={tone}>
  {#if dot}
    <span class="dot" class:pulse></span>
  {:else if icon}
    <Icon name={icon} size={12} stroke={2} />
  {/if}
  <span class="label">{@render children?.()}</span>
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 21px;
    padding: 0 8px;
    border-radius: var(--arc-r-pill);
    border: 1px solid transparent;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
    line-height: 1;
  }
  .badge.mono .label {
    font-family: var(--arc-mono);
    font-weight: 500;
    letter-spacing: 0;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }
  .dot.pulse {
    animation: badge-pulse 1.2s var(--arc-ease) infinite;
  }
  @keyframes badge-pulse {
    50% {
      opacity: 0.3;
    }
  }

  /* soft */
  .badge[data-variant="soft"][data-tone="primary"] {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
  }
  .badge[data-variant="soft"][data-tone="ok"] {
    background: var(--arc-ok-soft);
    color: var(--arc-ok);
  }
  .badge[data-variant="soft"][data-tone="warn"] {
    background: var(--arc-warn-soft);
    color: var(--arc-warn);
  }
  .badge[data-variant="soft"][data-tone="danger"] {
    background: var(--arc-danger-soft);
    color: var(--arc-danger);
  }
  .badge[data-variant="soft"][data-tone="info"] {
    background: var(--arc-info-soft);
    color: var(--arc-info);
  }
  .badge[data-variant="soft"][data-tone="neutral"] {
    background: var(--arc-n100);
    color: var(--arc-text-soft);
  }

  /* solid */
  .badge[data-variant="solid"][data-tone="primary"] {
    background: var(--arc-primary);
    color: #fff;
  }
  .badge[data-variant="solid"][data-tone="ok"] {
    background: var(--arc-ok);
    color: #fff;
  }
  .badge[data-variant="solid"][data-tone="warn"] {
    background: var(--arc-warn);
    color: #fff;
  }
  .badge[data-variant="solid"][data-tone="danger"] {
    background: var(--arc-danger);
    color: #fff;
  }
  .badge[data-variant="solid"][data-tone="info"] {
    background: var(--arc-info);
    color: #fff;
  }
  .badge[data-variant="solid"][data-tone="neutral"] {
    background: var(--arc-n600);
    color: #fff;
  }

  /* outline */
  .badge[data-variant="outline"] {
    background: var(--arc-surface);
    border-color: var(--arc-border-strong);
    color: var(--arc-text-soft);
  }
  .badge[data-variant="outline"][data-tone="primary"] {
    border-color: var(--arc-primary);
    color: var(--arc-primary-strong);
  }
  .badge[data-variant="outline"][data-tone="danger"] {
    border-color: var(--arc-danger);
    color: var(--arc-danger);
  }
</style>
