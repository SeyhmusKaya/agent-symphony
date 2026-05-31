<script lang="ts">
  import Icon from "$lib/icons/Icon.svelte";

  let {
    src = null,
    onClose,
  }: {
    src?: string | null;
    onClose: () => void;
  } = $props();

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={src ? onKey : undefined} />

{#if src}
  <div
    class="lb"
    role="button"
    tabindex="0"
    aria-label="Close"
    onclick={onClose}
    onkeydown={(e) => e.key === "Enter" && onClose()}
  >
    <button class="lb-close" title="Close (Esc)" aria-label="Close" onclick={onClose}>
      <Icon name="x" size={20} stroke={2.2} />
    </button>
    <img class="lb-img" {src} alt="Enlarged image" />
  </div>
{/if}

<style>
  .lb {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    padding: 48px;
    background: rgba(15, 17, 21, 0.86);
    backdrop-filter: blur(4px);
    animation: lb-in 0.16s var(--arc-ease);
    cursor: zoom-out;
  }
  @keyframes lb-in {
    from {
      opacity: 0;
    }
  }
  .lb-img {
    max-width: 100%;
    max-height: 100%;
    border-radius: var(--arc-r);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    animation: lb-pop 0.18s var(--arc-ease);
  }
  @keyframes lb-pop {
    from {
      transform: scale(0.96);
      opacity: 0;
    }
  }
  .lb-close {
    position: fixed;
    top: 18px;
    right: 18px;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: none;
    border-radius: var(--arc-r-pill);
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    transition: background 0.15s var(--arc-ease);
  }
  .lb-close:hover {
    background: rgba(255, 255, 255, 0.24);
  }
</style>
