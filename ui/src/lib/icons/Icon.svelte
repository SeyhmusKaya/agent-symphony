<script lang="ts">
  import { ICONS, type IconName } from "./paths";

  let {
    name,
    size = 16,
    stroke = 1.75,
    spin = false,
    class: cls = "",
  }: {
    name: IconName;
    size?: number;
    stroke?: number;
    spin?: boolean;
    class?: string;
  } = $props();
</script>

<svg
  class="arc-icon {cls}"
  class:spin
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {@html ICONS[name]}
</svg>

<style>
  .arc-icon {
    display: block;
    flex-shrink: 0;
  }
  .spin {
    animation: arc-icon-spin 0.8s linear infinite;
  }
  @keyframes arc-icon-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
