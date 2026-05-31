<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import type { IconName } from "$lib/icons/paths";

  let {
    variant = "ghost",
    size = "md",
    icon,
    iconSize,
    title,
    disabled = false,
    active = false,
    onDark = false,
    type = "button",
    onclick,
    children,
  }: {
    variant?: "primary" | "ghost" | "subtle" | "icon" | "danger";
    size?: "sm" | "md";
    icon?: IconName;
    iconSize?: number;
    title?: string;
    disabled?: boolean;
    active?: boolean;
    onDark?: boolean;
    type?: "button" | "submit";
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
  } = $props();

  const resolvedIconSize = $derived(iconSize ?? (size === "sm" ? 14 : 16));
</script>

<button
  {type}
  {title}
  {disabled}
  class="btn"
  class:active
  class:on-dark={onDark}
  data-variant={variant}
  data-size={size}
  aria-label={title}
  {onclick}
>
  {#if icon}
    <Icon name={icon} size={resolvedIconSize} />
  {/if}
  {#if children}
    <span class="txt">{@render children()}</span>
  {/if}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 1px solid transparent;
    border-radius: var(--arc-r-sm);
    font-family: inherit;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    transition:
      transform 0.15s var(--arc-ease),
      box-shadow 0.15s var(--arc-ease),
      background 0.15s var(--arc-ease),
      border-color 0.15s var(--arc-ease),
      color 0.15s var(--arc-ease);
  }
  .btn[data-size="md"] {
    padding: 8px 14px;
    font-size: 13px;
  }
  .btn[data-size="sm"] {
    padding: 6px 10px;
    font-size: 12px;
  }
  .btn[data-variant="icon"] {
    padding: 0;
  }
  .btn[data-variant="icon"][data-size="md"] {
    width: 32px;
    height: 32px;
  }
  .btn[data-variant="icon"][data-size="sm"] {
    width: 28px;
    height: 28px;
  }
  .btn:active:not(:disabled) {
    transform: scale(0.97);
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn[data-variant="primary"] {
    background: var(--arc-primary);
    color: #fff;
  }
  .btn[data-variant="primary"]:hover:not(:disabled) {
    background: var(--arc-primary-hover);
    transform: translateY(-1px);
    box-shadow: var(--arc-shadow-teal);
  }

  .btn[data-variant="danger"] {
    background: var(--arc-danger);
    color: #fff;
  }
  .btn[data-variant="danger"]:hover:not(:disabled) {
    filter: brightness(1.06);
  }

  .btn[data-variant="ghost"] {
    background: var(--arc-surface);
    border-color: var(--arc-border);
    color: var(--arc-text-soft);
  }
  .btn[data-variant="ghost"]:hover:not(:disabled) {
    border-color: var(--arc-primary);
    color: var(--arc-primary);
  }

  .btn[data-variant="subtle"],
  .btn[data-variant="icon"] {
    background: transparent;
    color: var(--arc-text-soft);
  }
  .btn[data-variant="subtle"]:hover:not(:disabled),
  .btn[data-variant="icon"]:hover:not(:disabled) {
    background: var(--arc-n100);
    color: var(--arc-text);
  }
  .btn[data-variant="subtle"].active,
  .btn[data-variant="icon"].active {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
  }

  /* on dark background (gradient header / topbar) */
  .btn.on-dark {
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.22);
    color: #fff;
  }
  .btn.on-dark:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.24);
    border-color: rgba(255, 255, 255, 0.34);
    color: #fff;
    transform: none;
    box-shadow: none;
  }
  .btn.on-dark.active {
    background: var(--arc-accent);
    border-color: var(--arc-accent);
    color: #fff;
  }
</style>
