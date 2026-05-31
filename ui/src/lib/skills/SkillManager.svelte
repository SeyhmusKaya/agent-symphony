<script lang="ts">
  // F2 SkillManager — role-based skill catalog manager.
  // Tabbed: Global / Mimar / Advisor-<key> / Sef-<projectId>. Under each tab,
  // skill cards (name, description, delete/load). Adding a new skill: give a name
  // or pick a local SKILL.md source.
  //
  // CLAUDE.md design rule: gradient teal header, rounded card, hover lift,
  // mobile-first responsive. No raw Bootstrap default.
  //
  // The Rust backend handler does not exist yet — the api wrappers are ready.
  // The component can be placed in NotesScreen or a Settings tab.

  import { onMount } from "svelte";
  import { open } from "@tauri-apps/plugin-dialog";
  import { confirmDialog } from "$lib/ui/confirm";
  import Icon from "$lib/icons/Icon.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Badge from "$lib/ui/Badge.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import {
    listSkills,
    attachSkill as apiAttach,
    detachSkill as apiDetach,
    type SkillEntry,
    type SkillRoleGroup,
  } from "$lib/api";

  let groups = $state<SkillRoleGroup[]>([]);
  let activeRole = $state<string>("global");
  let loading = $state(true);
  let err = $state<string | null>(null);
  let busy = $state(false);

  // New skill modal
  let newOpen = $state(false);
  let newName = $state("");
  let newSource = $state<string | null>(null);

  const activeGroup = $derived(
    groups.find((g) => g.role === activeRole) ?? { role: activeRole, skills: [] as SkillEntry[] },
  );

  async function refresh() {
    loading = true;
    err = null;
    try {
      groups = await listSkills();
      if (groups.length > 0 && !groups.find((g) => g.role === activeRole)) {
        activeRole = groups[0].role;
      }
    } catch (e) {
      err = (e as Error).message ?? "Could not load the skill list.";
      groups = [];
    } finally {
      loading = false;
    }
  }

  onMount(refresh);

  function roleLabel(role: string): string {
    if (role === "global") return "Global";
    if (role === "mimar") return "Mimar";
    if (role.startsWith("advisor-")) return "Advisor / " + role.slice("advisor-".length);
    if (role.startsWith("sef-")) return "Chief / " + role.slice("sef-".length);
    return role;
  }

  function roleTone(role: string): "primary" | "ok" | "warn" | "info" | "neutral" {
    if (role === "global") return "ok";
    if (role === "mimar") return "primary";
    if (role.startsWith("advisor-")) return "info";
    if (role.startsWith("sef-")) return "warn";
    return "neutral";
  }

  async function pickSourcePath() {
    const sel = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "SKILL.md", extensions: ["md"] }],
    });
    if (typeof sel === "string") newSource = sel;
  }

  async function pickSourceFolder() {
    const sel = await open({ multiple: false, directory: true });
    if (typeof sel === "string") newSource = sel;
  }

  function openNewModal() {
    newName = "";
    newSource = null;
    newOpen = true;
  }

  async function submitNew() {
    if (!newName.trim()) return;
    busy = true;
    try {
      await apiAttach(activeRole, newName.trim(), newSource ?? undefined);
      newOpen = false;
      await refresh();
    } catch (e) {
      err = (e as Error).message ?? "Could not add the skill.";
    } finally {
      busy = false;
    }
  }

  async function removeSkill(name: string) {
    if (!(await confirmDialog(`Delete the '${name}' skill?`, { danger: true, okLabel: "Delete" }))) return;
    busy = true;
    try {
      await apiDetach(activeRole, name);
      await refresh();
    } catch (e) {
      err = (e as Error).message ?? "Could not delete the skill.";
    } finally {
      busy = false;
    }
  }
</script>

<div class="skill-manager">
  <header class="hdr">
    <div class="hdr-left">
      <div class="hdr-icon">
        <Icon name="sparkles" size={20} />
      </div>
      <div class="hdr-text">
        <h2>Skill Manager</h2>
        <p>Role-based SKILL.md catalog (~/.architect/skills/)</p>
      </div>
    </div>
    <div class="hdr-right">
      <Button variant="primary" icon="plus" onclick={openNewModal} onDark>
        New Skill
      </Button>
    </div>
  </header>

  {#if err}
    <div class="err">{err}</div>
  {/if}

  {#if loading}
    <div class="loading">Loading...</div>
  {:else}
    <nav class="tabs" aria-label="Role selection">
      {#if groups.length === 0}
        <span class="tab-empty">No role folders yet. They are created when you add a new skill.</span>
      {/if}
      {#each groups as g (g.role)}
        <button
          type="button"
          class="tab"
          class:active={activeRole === g.role}
          onclick={() => (activeRole = g.role)}
        >
          <Badge variant="soft" tone={roleTone(g.role)}>{roleLabel(g.role)}</Badge>
          <span class="tab-count">{g.skills.length}</span>
        </button>
      {/each}
    </nav>

    <section class="content">
      {#if activeGroup.skills.length === 0}
        <EmptyState
          icon="sparkles"
          title="No skills for this role"
          text="Add one with 'New Skill' at the top right. SKILL.md frontmatter (name + description) is required."
        />
      {:else}
        <div class="grid">
          {#each activeGroup.skills as s (s.name)}
            <article class="card">
              <div class="card-head">
                <div class="card-title">
                  <Icon name="sparkles" size={14} />
                  <span class="name" title={s.name}>{s.name}</span>
                </div>
                <Button
                  variant="icon"
                  size="sm"
                  icon="trash"
                  title="Delete skill"
                  disabled={busy}
                  onclick={() => removeSkill(s.name)}
                />
              </div>
              <p class="desc">{s.description || "No description."}</p>
              <div class="card-foot">
                <code class="path" title={s.path}>{s.path}</code>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  {#if newOpen}
    <div
      class="modal-bg"
      role="presentation"
      onclick={() => (newOpen = false)}
      onkeydown={(e) => {
        if (e.key === "Escape") newOpen = false;
      }}
    >
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-modal-title"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <header class="modal-hdr">
          <h3 id="skill-modal-title">New Skill: {roleLabel(activeRole)}</h3>
          <Button variant="icon" size="sm" icon="x" onclick={() => (newOpen = false)} />
        </header>
        <div class="modal-body">
          <label class="field">
            <span>Skill name</span>
            <input
              type="text"
              bind:value={newName}
              placeholder="e.g. typescript-master"
              pattern="[A-Za-z0-9_.-]+"
            />
            <small>Only A-Z, 0-9, underscore, dot, hyphen.</small>
          </label>

          <div class="field">
            <span>Source (optional)</span>
            <div class="row">
              <Button variant="ghost" icon="folder" size="sm" onclick={pickSourcePath}>
                Pick SKILL.md
              </Button>
              <Button variant="ghost" icon="folder" size="sm" onclick={pickSourceFolder}>
                Pick folder
              </Button>
              {#if newSource}
                <code class="src-path">{newSource}</code>
              {/if}
            </div>
            <small>If left empty, a skeleton SKILL.md is created (edit it later).</small>
          </div>
        </div>
        <footer class="modal-foot">
          <Button variant="ghost" onclick={() => (newOpen = false)}>Cancel</Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!newName.trim() || busy}
            onclick={submitNew}
          >
            Add
          </Button>
        </footer>
      </div>
    </div>
  {/if}
</div>

<style>
  .skill-manager {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 18px;
    color: var(--arc-text);
  }

  /* Gradient teal header — CLAUDE.md design rule */
  .hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 22px;
    border-radius: var(--arc-r-md);
    background: linear-gradient(135deg, #0F766E 0%, #14B8A6 100%);
    color: #fff;
    box-shadow: 0 6px 18px -10px rgba(15, 118, 110, 0.55);
  }
  .hdr-left {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .hdr-icon {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
  }
  .hdr-text h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .hdr-text p {
    margin: 4px 0 0;
    font-size: 12px;
    font-weight: 500;
    opacity: 0.86;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .err {
    padding: 10px 14px;
    border-radius: var(--arc-r-sm);
    background: var(--arc-danger-soft);
    color: var(--arc-danger);
    font-size: 13px;
  }

  .loading {
    padding: 26px;
    text-align: center;
    color: var(--arc-text-soft);
    font-size: 13px;
  }

  /* Tab strip */
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 6px;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-md);
  }
  .tab-empty {
    padding: 10px 14px;
    font-size: 12.5px;
    color: var(--arc-text-soft);
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid transparent;
    border-radius: var(--arc-r-pill);
    background: transparent;
    cursor: pointer;
    transition: background 0.15s var(--arc-ease), border-color 0.15s var(--arc-ease);
  }
  .tab:hover {
    background: var(--arc-n100);
  }
  .tab.active {
    background: var(--arc-primary-soft);
    border-color: var(--arc-primary);
  }
  .tab-count {
    font-size: 11px;
    font-weight: 700;
    color: var(--arc-text-soft);
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--arc-n100);
  }

  /* Skill grid + cards */
  .content {
    min-height: 200px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 14px 12px;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-md);
    transition:
      transform 0.18s var(--arc-ease),
      box-shadow 0.18s var(--arc-ease),
      border-color 0.18s var(--arc-ease);
  }
  .card:hover {
    transform: translateY(-2px);
    box-shadow: var(--arc-shadow-md, 0 10px 24px -16px rgba(0, 0, 0, 0.18));
    border-color: var(--arc-primary);
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .card-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--arc-primary-strong);
    font-weight: 600;
    font-size: 13.5px;
    min-width: 0;
  }
  .card-title .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .desc {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--arc-text-soft);
    min-height: 1.45em;
  }
  .card-foot {
    margin-top: auto;
  }
  .path {
    display: block;
    font-family: var(--arc-mono);
    font-size: 10.5px;
    color: var(--arc-text-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Modal */
  .modal-bg {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.45);
    backdrop-filter: blur(2px);
    display: grid;
    place-items: center;
    z-index: 60;
  }
  .modal {
    width: min(480px, 92vw);
    background: var(--arc-surface);
    border-radius: var(--arc-r-md);
    box-shadow: 0 24px 48px -20px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .modal-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--arc-border);
  }
  .modal-hdr h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--arc-text);
  }
  .modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .modal-foot {
    padding: 12px 16px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid var(--arc-border);
    background: var(--arc-n50, var(--arc-surface));
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field > span {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--arc-text-soft);
  }
  .field input[type="text"] {
    height: 34px;
    padding: 0 10px;
    font-size: 13px;
    font-family: inherit;
    color: var(--arc-text);
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    transition: border-color 0.15s var(--arc-ease);
  }
  .field input[type="text"]:focus {
    outline: none;
    border-color: var(--arc-primary);
  }
  .field small {
    font-size: 11px;
    color: var(--arc-text-soft);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .src-path {
    font-family: var(--arc-mono);
    font-size: 11px;
    padding: 4px 8px;
    border-radius: var(--arc-r-sm);
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  /* Mobile responsive */
  @media (max-width: 720px) {
    .hdr {
      flex-direction: column;
      align-items: flex-start;
      gap: 14px;
    }
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
