<script lang="ts">
  import Icon from "$lib/icons/Icon.svelte";
  import type { IconName } from "$lib/icons/paths";

  let {
    label = "",
    size = 36,
    variant = "soft",
    icon,
    image,
  }: {
    label?: string;
    size?: number;
    variant?: "gradient" | "soft" | "outline";
    icon?: IconName;
    image?: string;
  } = $props();

  let imgFailed = $state(false);
  $effect(() => { image; imgFailed = false; });

  const initials = $derived.by(() => {
    const parts = label.trim().split(/[\s\-_/]+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  });

  const fontSize = $derived(Math.round(size * 0.38));
  const iconSize = $derived(Math.round(size * 0.52));
  const showImage = $derived(!!image && !imgFailed);
</script>

<span
  class="avatar"
  data-variant={variant}
  class:has-image={showImage}
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{fontSize}px"
  style:border-radius="{Math.round(size * 0.3)}px"
>
  {#if showImage}
    <img src={image} alt={label} class="avatar-img" onerror={() => (imgFailed = true)} />
  {:else if icon}
    <Icon name={icon} size={iconSize} stroke={1.9} />
  {:else}
    {initials}
  {/if}
</span>

<style>
  .avatar {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    font-weight: 600;
    letter-spacing: 0.01em;
    user-select: none;
    overflow: hidden;
  }
  .avatar-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .avatar.has-image {
    background: transparent !important;
    border: none !important;
  }
  .avatar[data-variant="gradient"] {
    background: var(--arc-grad-header);
    color: #fff;
  }
  .avatar[data-variant="soft"] {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
  }
  .avatar[data-variant="outline"] {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    color: var(--arc-primary-strong);
  }
</style>
