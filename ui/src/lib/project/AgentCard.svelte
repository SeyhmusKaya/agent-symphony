<script lang="ts">
  // Left-panel specialist card — extracted from ProjectScreen.svelte.
  // selected/running/error/activity color dot + meta badges.
  // Parent: passes selectAgent(name) + agentHasActivity(name) callbacks.
  import Avatar from "$lib/ui/Avatar.svelte";
  import Badge from "$lib/ui/Badge.svelte";
  import { agentIcon } from "$lib/ui/agentVisual";
  import { STATUS_LABEL, statusTone } from "./helpers.js";
  import type { AgentView } from "$lib/store.svelte";

  interface Props {
    agent: AgentView;
    selected: boolean;
    hasActivity: boolean;
    onSelect: (name: string) => void;
    // F1.1 (Option B): readonly mode — the direct chat UX with specialists like
    // Volpora was removed. The card is now read-only (the specialist's status,
    // model, activity are shown but clicking does not open a chat screen). The
    // chief spawns the specialist via the Agent tool; the user talks to the chief.
    readOnly?: boolean;
  }
  let { agent, selected, hasActivity, onSelect, readOnly = false }: Props = $props();

  const isBusy = $derived(agent.status === "calisiyor");
  const isErr = $derived(agent.status === "hata");
  const showActivity = $derived(!selected && !isBusy && !isErr && hasActivity);

  // Skills loaded for the specialist. Shown in an expandable panel on click — so
  // skills can be seen (without opening a chat) on readOnly specialists too. Source:
  // status payload agents[].skills (registry SpecialistDef.skills).
  const skills = $derived(Array.isArray(agent.skills) ? agent.skills : []);
  let expanded = $state(false);
  function handleClick() {
    // Always toggle the skill panel. If not readOnly, also select.
    expanded = !expanded;
    if (!readOnly) onSelect(agent.name);
  }
</script>

<div
  class="agent-card"
  class:selected
  class:running={isBusy}
  class:err={isErr}
  class:readonly={readOnly}
  class:expanded
  role="button"
  tabindex={0}
  onclick={handleClick}
  onkeydown={(e) => e.key === "Enter" && handleClick()}
  title={readOnly
    ? "The specialist is managed by the chief (Agent tool). Click: see loaded skills."
    : "Click: select + see loaded skills."}
>
  <div class="agent-top">
    <span
      class="ag-dot"
      class:on={selected && !isBusy && !isErr}
      class:busy={isBusy}
      class:errdot={isErr}
      class:activity={showActivity}
      title={isBusy
        ? "Running — working on a task"
        : isErr
          ? "Error"
          : selected
            ? "Selected"
            : showActivity
              ? "Idle — has past activity"
              : "Idle"}
    ></span>
    <Avatar label={agent.name} icon={agentIcon(agent.name, agent.role)} size={34} variant="soft" />
    <div class="agent-id">
      <div class="agent-name">{agent.name}</div>
      <div class="agent-role">{agent.role}</div>
    </div>
    <Badge variant="soft" tone={statusTone(agent.status)} dot pulse={agent.status === "calisiyor"}>
      {STATUS_LABEL[agent.status]}
    </Badge>
  </div>
  <div class="agent-meta">
    <Badge variant="soft" tone="primary" mono>{agent.model}</Badge>
    <Badge variant="outline" mono>{agent.effort}</Badge>
    <!-- Skill count chip — click opens the detail panel (below). -->
    <span class="skill-count" class:on={expanded}>
      {skills.length} skill{#if skills.length}{/if}
      <svg class="chev" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
        <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
  </div>
  {#if expanded}
    <div class="skill-panel">
      {#if skills.length}
        <div class="skill-list">
          {#each skills as s (s)}
            <span class="skill-badge" title={s}>{s}</span>
          {/each}
        </div>
      {:else}
        <div class="skill-empty">No skills loaded</div>
      {/if}
    </div>
  {/if}
  <!-- NOTE: the a.task block was removed in Fix 102. The left ag-dot pulse +
       running badge are enough signal for the working state. -->
</div>

<style>
  .agent-card {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r);
    box-shadow: var(--arc-shadow-sm);
    padding: 12px;
    cursor: pointer;
    transition:
      transform 0.15s var(--arc-ease),
      box-shadow 0.15s var(--arc-ease),
      border-color 0.15s var(--arc-ease);
  }
  .agent-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--arc-shadow-teal);
    border-color: var(--arc-primary);
  }
  .agent-card.selected {
    border-color: var(--arc-primary);
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 8%, var(--arc-surface));
    box-shadow: 0 2px 8px color-mix(in srgb, var(--arc-primary) 14%, transparent);
  }
  .agent-card.running {
    border-color: var(--arc-accent);
  }
  .agent-card.err {
    border-color: var(--arc-danger);
  }
  /* F1.1: readonly mode (Option B) — no specialist chat BUT the card now opens
     loaded skills on click. So pointer + hover lift are KEPT (there is interaction). */
  .agent-card.readonly {
    cursor: pointer;
  }
  .agent-top {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  /* Colored status dot: gray=idle/selected, orange=running, red=error, green=unread activity */
  .ag-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--arc-border);
    flex-shrink: 0;
    transition: background 0.2s, box-shadow 0.2s, transform 0.15s;
  }
  /* Selected but idle: neutral gray (being selected is already clear from the card highlight).
     Green is reserved ONLY for the "unread activity" signal. */
  .ag-dot.on {
    background: var(--arc-text-soft);
    transform: scale(1.1);
  }
  /* Running → orange, blinking. */
  .ag-dot.busy {
    background: #f59e0b;
    transform: scale(1.3);
    box-shadow: 0 0 0 3px color-mix(in srgb, #f59e0b 22%, transparent);
    animation: ag-dot-pulse 1.2s ease-in-out infinite;
  }
  .ag-dot.errdot {
    background: var(--arc-danger);
    transform: scale(1.3);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-danger) 22%, transparent);
    animation: ag-dot-pulse 1.2s ease-in-out infinite;
  }
  /* Finished & unseen → green, blinking. */
  .ag-dot.activity {
    background: #16a34a;
    transform: scale(1.3);
    box-shadow: 0 0 0 3px color-mix(in srgb, #16a34a 22%, transparent);
    animation: ag-dot-pulse 1.2s ease-in-out infinite;
  }
  @keyframes ag-dot-pulse {
    0%, 100% { opacity: 1; transform: scale(1.3); }
    50%       { opacity: 0.45; transform: scale(1.0); }
  }
  .agent-id {
    flex: 1;
    min-width: 0;
  }
  .agent-name {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--arc-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .agent-role {
    font-size: 11.5px;
    color: var(--arc-text-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .agent-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    margin-top: 10px;
  }
  /* Skill sayisi cipi — meta satirinin sagina yaslanir, tiklanabilir gorunum. */
  .skill-count {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10.5px;
    font-weight: 600;
    color: var(--arc-text-soft);
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--arc-primary, #0F766E) 22%, var(--arc-border));
    border-radius: 999px;
    padding: 2px 8px;
    line-height: 1.4;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .skill-count.on {
    color: var(--arc-primary-strong, #0F766E);
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 14%, transparent);
    border-color: color-mix(in srgb, var(--arc-primary, #0F766E) 40%, var(--arc-border));
  }
  .skill-count .chev {
    transition: transform 0.18s var(--arc-ease, ease);
  }
  .skill-count.on .chev {
    transform: rotate(180deg);
  }
  /* Acilir skill paneli */
  .skill-panel {
    margin-top: 9px;
    padding-top: 9px;
    border-top: 1px dashed var(--arc-border);
  }
  .skill-list {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .skill-badge {
    font-size: 11px;
    font-weight: 500;
    color: var(--arc-primary-strong, #0F766E);
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--arc-primary, #0F766E) 28%, transparent);
    border-radius: 6px;
    padding: 3px 9px;
    line-height: 1.4;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .skill-empty {
    font-size: 11px;
    font-style: italic;
    color: var(--arc-text-faint);
  }
</style>
