<script lang="ts">
  // Left navigation rail — collapse/expand toggle + 6 main tab buttons.
  // Parent: holds activeTab + railSel, passes a selectRail(mode) callback.
  // The Ctrl+\ shortcut is captured in the parent and forwarded to the toggleRail() prop.
  import Icon from "$lib/icons/Icon.svelte";

  interface Props {
    railExpanded: boolean;
    activeTab: string;
    railSel: string;
    onToggle: () => void;
    onSelect: (mode: string) => void;
  }
  let { railExpanded, activeTab, railSel, onToggle, onSelect }: Props = $props();

  const onLauncher = $derived(activeTab === "launcher");
</script>

<nav class="rail" class:expanded={railExpanded} id="rail-nav-root">
  <div class="rail-head">
    <div class="rail-logo" title={railExpanded ? undefined : "Agent Symphony"}>
      <img src="/logo-square.png" alt="Agent Symphony" />
    </div>
    <button
      class="rail-toggle"
      type="button"
      aria-expanded={railExpanded}
      aria-controls="rail-nav"
      aria-label={railExpanded ? "Collapse navigation" : "Expand navigation"}
      title={railExpanded ? "Collapse (Ctrl+\\)" : "Expand (Ctrl+\\)"}
      onclick={onToggle}
    >
      <Icon name={railExpanded ? "panelLeftClose" : "panelLeftOpen"} size={18} />
    </button>
  </div>
  <div class="rail-nav" id="rail-nav">
    <button
      class="rail-btn"
      class:on={onLauncher && railSel === "sohbet"}
      title={railExpanded ? undefined : "Chat"}
      aria-label="Chat"
      onclick={() => onSelect("sohbet")}
    >
      <Icon name="message" size={19} />
      <span class="rail-label">Chat</span>
    </button>
    <button
      class="rail-btn"
      class:on={onLauncher && railSel === "notlar"}
      title={railExpanded ? undefined : "Notes"}
      aria-label="Notes"
      onclick={() => onSelect("notlar")}
    >
      <Icon name="fileText" size={19} />
      <span class="rail-label">Notes</span>
    </button>
    <button
      class="rail-btn"
      class:on={onLauncher && railSel === "kullanim"}
      title={railExpanded ? undefined : "Usage"}
      aria-label="Usage"
      onclick={() => onSelect("kullanim")}
    >
      <Icon name="gauge" size={19} />
      <span class="rail-label">Usage</span>
    </button>
    <button
      class="rail-btn"
      class:on={onLauncher && railSel === "raporlar"}
      title={railExpanded ? undefined : "Daily reports"}
      aria-label="Daily reports"
      onclick={() => onSelect("raporlar")}
    >
      <Icon name="activity" size={19} />
      <span class="rail-label">Daily reports</span>
    </button>
    <button
      class="rail-btn"
      class:on={onLauncher && railSel === "sunucular"}
      title={railExpanded ? undefined : "Servers"}
      aria-label="Servers"
      onclick={() => onSelect("sunucular")}
    >
      <Icon name="server" size={19} />
      <span class="rail-label">Servers</span>
    </button>
    <button
      class="rail-btn"
      class:on={onLauncher && railSel === "araclar"}
      title={railExpanded ? undefined : "Tools"}
      aria-label="Tools"
      onclick={() => onSelect("araclar")}
    >
      <Icon name="wrench" size={19} />
      <span class="rail-label">Tools</span>
    </button>
    <button
      class="rail-btn"
      class:on={onLauncher && railSel === "codegraph"}
      title={railExpanded ? undefined : "Code Graph"}
      aria-label="Code Graph"
      onclick={() => onSelect("codegraph")}
    >
      <!-- Pre-indexed symbol graph for the Mimar's Architect source code -->
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="6" r="2"/>
        <circle cx="6" cy="18" r="2"/>
        <circle cx="18" cy="18" r="2"/>
        <path d="M12 8.2v3M10.5 16.7 7.5 10M13.5 16.7 16.5 10M8 18h8"/>
      </svg>
      <span class="rail-label">Code Graph</span>
    </button>
  </div>
</nav>

<style>
  .rail {
    width: 56px;
    flex-shrink: 0;
    background: var(--arc-n900);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 0;
    gap: 14px;
    transition: width 180ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .rail.expanded {
    width: 200px;
    align-items: stretch;
  }
  .rail-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .rail.expanded .rail-head {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: 0 10px 0 12px;
    gap: 8px;
  }
  .rail-logo {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: transparent;
    flex-shrink: 0;
  }
  .rail-logo img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .rail-toggle {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--arc-r-sm);
    background: transparent;
    color: var(--arc-n400);
    cursor: pointer;
    transition: background 0.15s var(--arc-ease), color 0.15s var(--arc-ease),
      transform 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .rail-toggle:hover {
    background: rgba(255, 255, 255, 0.07);
    color: var(--arc-accent);
    transform: scale(1.05);
  }
  .rail-toggle:focus-visible {
    outline: 2px solid var(--arc-accent);
    outline-offset: 1px;
  }
  .rail-toggle:active {
    transform: scale(0.96);
  }
  .rail-nav {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rail.expanded .rail-nav {
    padding: 0 8px;
  }
  .rail-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: none;
    border-radius: var(--arc-r-sm);
    background: transparent;
    color: var(--arc-n400);
    transition: background 0.15s var(--arc-ease), color 0.15s var(--arc-ease), width 180ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .rail.expanded .rail-btn {
    width: 100%;
    justify-content: flex-start;
    padding: 0 12px;
    gap: 10px;
  }
  .rail-btn:hover {
    background: rgba(255, 255, 255, 0.07);
    color: #fff;
  }
  .rail-btn.on {
    background: rgba(20, 184, 166, 0.16);
    color: var(--arc-accent);
  }
  .rail-btn.on::before {
    content: "";
    position: absolute;
    left: -12px;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 22px;
    border-radius: 0 3px 3px 0;
    background: var(--arc-accent);
    transition: left 180ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .rail.expanded .rail-btn.on::before {
    left: -8px;
  }
  .rail-label {
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 0;
    opacity: 0;
    transition: max-width 180ms cubic-bezier(0.4, 0, 0.2, 1), opacity 120ms ease;
    pointer-events: none;
  }
  .rail.expanded .rail-label {
    max-width: 130px;
    opacity: 1;
  }
</style>
