<script lang="ts">
  import Icon from "$lib/icons/Icon.svelte";
  import { chatBg, setChatBg } from "$lib/chatBg.svelte";

  let open = $state(false);
  let btn: HTMLButtonElement | null = $state(null);
  let panel: HTMLDivElement | null = $state(null);

  const PRESETS = [
    "#ffffff",
    "#fbfbf9",
    "#f7f8fa",
    "#f4f6f8",
    "#eceff3",
    "#eeede5",
    "#f4ecd8",
    "#e8f4f1",
  ];

  function toggle() {
    open = !open;
  }
  function pick(c: string) {
    setChatBg(c);
  }

  function onDocClick(e: MouseEvent) {
    if (!open) return;
    const t = e.target as Node;
    if (panel?.contains(t) || btn?.contains(t)) return;
    open = false;
  }
</script>

<svelte:window onclick={onDocClick} />

<div class="picker-wrap">
  <button
    bind:this={btn}
    class="picker-btn"
    title="Chat background color"
    aria-label="Chat background color"
    onclick={toggle}
  >
    <Icon name="palette" size={14} />
  </button>
  {#if open}
    <div bind:this={panel} class="picker-panel" role="dialog">
      <div class="picker-row">
        {#each PRESETS as c (c)}
          <button
            class="swatch"
            class:on={chatBg.color.toLowerCase() === c.toLowerCase()}
            style="background:{c}"
            title={c}
            aria-label={c}
            onclick={() => pick(c)}
          ></button>
        {/each}
      </div>
      <label class="picker-custom">
        <span>Custom</span>
        <input
          type="color"
          value={chatBg.color}
          oninput={(e) => pick((e.target as HTMLInputElement).value)}
        />
        <code>{chatBg.color}</code>
      </label>
    </div>
  {/if}
</div>

<style>
  .picker-wrap {
    position: relative;
    display: inline-flex;
  }
  .picker-btn {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    background: var(--arc-surface);
    color: var(--arc-text-soft);
    cursor: pointer;
    transition: color 0.15s var(--arc-ease), border-color 0.15s var(--arc-ease),
      box-shadow 0.15s var(--arc-ease);
  }
  .picker-btn:hover {
    color: var(--arc-primary);
    border-color: var(--arc-primary-soft);
    box-shadow: var(--arc-shadow-sm);
  }
  .picker-panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 50;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r);
    box-shadow: var(--arc-shadow-lg);
    padding: 12px;
    width: 232px;
  }
  .picker-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .swatch {
    width: 100%;
    aspect-ratio: 1;
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    cursor: pointer;
    padding: 0;
    transition: transform 0.12s var(--arc-ease), box-shadow 0.12s var(--arc-ease);
  }
  .swatch:hover {
    transform: translateY(-1px);
    box-shadow: var(--arc-shadow-sm);
  }
  .swatch.on {
    outline: 2px solid var(--arc-primary);
    outline-offset: 1px;
  }
  .picker-custom {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--arc-border);
    font-size: 11.5px;
    color: var(--arc-text-soft);
  }
  .picker-custom span {
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 10px;
  }
  .picker-custom input[type="color"] {
    width: 30px;
    height: 24px;
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    padding: 0;
    background: transparent;
    cursor: pointer;
  }
  .picker-custom code {
    font-family: var(--arc-mono);
    font-size: 11px;
    color: var(--arc-text);
    margin-left: auto;
  }
</style>
