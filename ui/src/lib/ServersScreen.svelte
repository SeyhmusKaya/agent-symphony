<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Badge from "$lib/ui/Badge.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import { confirmDialog } from "$lib/ui/confirm";
  import {
    listServers,
    addServer,
    updateServer,
    deleteServer,
    testServerConnection,
    type Server,
    type ServerInput,
  } from "$lib/api";

  let servers = $state<Server[]>([]);
  let loading = $state(true);
  let modalOpen = $state(false);
  let editing = $state<Server | null>(null);
  let testResults = $state<Record<string, { ok: boolean; msg: string }>>({});
  let busy = $state(false);

  // Form fields
  let f_name = $state("");
  let f_host = $state("");
  let f_port = $state(22);
  let f_user = $state("");
  let f_authType = $state<"password" | "key">("password");
  let f_password = $state("");
  let f_keyPath = $state("");
  let f_panelUrl = $state("");
  let f_tags = $state("");
  let f_notes = $state("");

  function resetForm() {
    f_name = "";
    f_host = "";
    f_port = 22;
    f_user = "";
    f_authType = "password";
    f_password = "";
    f_keyPath = "";
    f_panelUrl = "";
    f_tags = "";
    f_notes = "";
  }

  function openNew() {
    editing = null;
    resetForm();
    modalOpen = true;
  }

  function openEdit(s: Server) {
    editing = s;
    f_name = s.name;
    f_host = s.host;
    f_port = s.port;
    f_user = s.user;
    f_authType = s.authType;
    f_password = s.password ?? "";
    f_keyPath = s.privateKeyPath ?? "";
    f_panelUrl = s.panelUrl ?? "";
    f_tags = (s.tags ?? []).join(", ");
    f_notes = s.notes ?? "";
    modalOpen = true;
  }

  async function refresh() {
    servers = await listServers();
  }

  function buildInput(): ServerInput {
    const tags = f_tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return {
      name: f_name.trim(),
      host: f_host.trim(),
      port: Number(f_port) || 22,
      user: f_user.trim(),
      authType: f_authType,
      password: f_authType === "password" ? f_password : undefined,
      privateKeyPath: f_authType === "key" ? f_keyPath.trim() || undefined : undefined,
      panelUrl: f_panelUrl.trim() || undefined,
      tags,
      notes: f_notes.trim() || undefined,
    };
  }

  async function save() {
    if (!f_name.trim() || !f_host.trim() || !f_user.trim()) return;
    busy = true;
    try {
      const input = buildInput();
      if (editing) {
        await updateServer(editing.id, input);
      } else {
        await addServer(input);
      }
      modalOpen = false;
      await refresh();
    } finally {
      busy = false;
    }
  }

  async function remove(s: Server) {
    if (!(await confirmDialog(`Delete the server "${s.name}"?`, { danger: true, okLabel: "Delete", title: "Delete server" }))) return;
    await deleteServer(s.id);
    await refresh();
  }

  async function testConn(s: Server) {
    testResults = { ...testResults, [s.id]: { ok: false, msg: "Testing..." } };
    try {
      const out = await testServerConnection(s.id);
      testResults = { ...testResults, [s.id]: { ok: true, msg: out || "OK" } };
    } catch (e) {
      testResults = {
        ...testResults,
        [s.id]: { ok: false, msg: String(e) },
      };
    }
  }

  onMount(async () => {
    try {
      await refresh();
    } finally {
      loading = false;
    }
  });
</script>

<div class="screen">
  <header class="screen-head">
    <div>
      <span class="arc-caption">Infrastructure</span>
      <div class="screen-title">Servers</div>
    </div>
    <Button variant="primary" icon="plus" onclick={openNew}>Add server</Button>
  </header>

  <div class="screen-body">
    {#if loading}
      <p class="muted">Loading…</p>
    {:else if servers.length === 0}
      <EmptyState
        icon="server"
        title="No servers yet"
        text="Add SSH servers here so projects and agents can deploy or run commands."
      />
    {:else}
      <div class="grid">
        {#each servers as s (s.id)}
          <article class="card">
            <header class="card-head">
              <div class="card-ic">
                <Icon name="server" size={20} />
              </div>
              <div class="card-id">
                <div class="card-name">{s.name}</div>
                <div class="card-sub">{s.user}@{s.host}:{s.port}</div>
              </div>
              <Badge variant="soft" tone={s.authType === "key" ? "ok" : "neutral"}>
                {s.authType}
              </Badge>
            </header>

            {#if s.tags.length}
              <div class="tags">
                {#each s.tags as t (t)}
                  <span class="tag">#{t}</span>
                {/each}
              </div>
            {/if}

            {#if s.panelUrl}
              <a class="panel-link" href={s.panelUrl} target="_blank" rel="noreferrer">
                <Icon name="share" size={12} /> Panel
              </a>
            {/if}

            {#if s.notes}
              <p class="notes">{s.notes}</p>
            {/if}

            {#if testResults[s.id]}
              <div class="test" class:ok={testResults[s.id].ok} class:fail={!testResults[s.id].ok}>
                {testResults[s.id].msg}
              </div>
            {/if}

            <footer class="card-foot">
              <button class="mini" onclick={() => testConn(s)}>
                <Icon name="activity" size={12} /> Test
              </button>
              <button class="mini" onclick={() => openEdit(s)}>
                <Icon name="edit" size={12} /> Edit
              </button>
              <button class="mini danger" onclick={() => remove(s)}>
                <Icon name="trash" size={12} /> Delete
              </button>
            </footer>
          </article>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if modalOpen}
  <div
    class="m-backdrop"
    role="button"
    tabindex="-1"
    aria-label="Close"
    onclick={() => (modalOpen = false)}
    onkeydown={(e) => e.key === "Escape" && (modalOpen = false)}
  ></div>
  <div class="m-modal">
    <div class="m-head">{editing ? "Edit server" : "Add server"}</div>
    <div class="m-body">
      <label class="row">
        <span>Name</span>
        <input type="text" bind:value={f_name} placeholder="Production / Hetzner" />
      </label>
      <div class="row2">
        <label class="row">
          <span>Host</span>
          <input type="text" bind:value={f_host} placeholder="192.168.1.1 or domain" />
        </label>
        <label class="row narrow">
          <span>Port</span>
          <input type="number" bind:value={f_port} min="1" max="65535" />
        </label>
      </div>
      <label class="row">
        <span>User</span>
        <input type="text" bind:value={f_user} placeholder="root" />
      </label>
      <label class="row">
        <span>Auth</span>
        <select bind:value={f_authType}>
          <option value="password">Password</option>
          <option value="key">SSH key</option>
        </select>
      </label>
      {#if f_authType === "password"}
        <label class="row">
          <span>Password</span>
          <input type="password" bind:value={f_password} />
        </label>
      {:else}
        <label class="row">
          <span>Key path</span>
          <input type="text" bind:value={f_keyPath} placeholder="C:\Users\...\id_ed25519" />
        </label>
      {/if}
      <label class="row">
        <span>Panel URL</span>
        <input type="url" bind:value={f_panelUrl} placeholder="https://panel.example.com" />
      </label>
      <label class="row">
        <span>Tags</span>
        <input type="text" bind:value={f_tags} placeholder="hetzner, prod, deploy (comma)" />
      </label>
      <label class="row">
        <span>Notes</span>
        <textarea rows="2" bind:value={f_notes}></textarea>
      </label>
    </div>
    <div class="m-foot">
      <button class="btn-cancel" onclick={() => (modalOpen = false)}>Cancel</button>
      <button class="btn-ok" disabled={busy} onclick={save}>
        {editing ? "Save" : "Add"}
      </button>
    </div>
  </div>
{/if}

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--arc-bg);
  }
  .screen-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: var(--arc-surface);
    border-bottom: 1px solid var(--arc-border);
  }
  .screen-head .arc-caption {
    font-size: 9.5px;
  }
  .screen-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--arc-text);
  }
  .screen-body {
    flex: 1;
    overflow-y: auto;
    padding: 22px 24px;
  }
  .muted {
    color: var(--arc-text-faint);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
    gap: 14px;
  }
  .card {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-lg);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: transform 0.15s var(--arc-ease), box-shadow 0.15s var(--arc-ease),
      border-color 0.15s var(--arc-ease);
  }
  .card:hover {
    transform: translateY(-1px);
    box-shadow: var(--arc-shadow-sm);
    border-color: var(--arc-primary-soft);
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .card-ic {
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border-radius: var(--arc-r-sm);
    background: var(--arc-grad-header);
    color: #fff;
    flex-shrink: 0;
  }
  .card-id {
    flex: 1;
    min-width: 0;
  }
  .card-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--arc-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-sub {
    font-size: 11.5px;
    color: var(--arc-text-faint);
    font-family: var(--arc-mono);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tag {
    font-size: 10.5px;
    font-family: var(--arc-mono);
    background: var(--arc-n100);
    color: var(--arc-text-soft);
    border-radius: var(--arc-r-pill);
    padding: 2px 8px;
  }
  .panel-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--arc-primary);
    text-decoration: none;
  }
  .panel-link:hover {
    text-decoration: underline;
  }
  .notes {
    margin: 0;
    font-size: 12px;
    color: var(--arc-text-soft);
    line-height: 1.4;
  }
  .test {
    font-size: 11.5px;
    font-family: var(--arc-mono);
    padding: 6px 8px;
    border-radius: var(--arc-r-sm);
    white-space: pre-wrap;
    word-break: break-all;
  }
  .test.ok {
    background: var(--arc-ok-soft, rgba(16, 185, 129, 0.1));
    color: var(--arc-ok, #059669);
  }
  .test.fail {
    background: var(--arc-danger-soft);
    color: var(--arc-danger);
  }
  .card-foot {
    display: flex;
    gap: 6px;
    border-top: 1px solid var(--arc-border);
    padding-top: 10px;
    margin-top: auto;
  }
  .mini {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11.5px;
    padding: 5px 9px;
    border: 1px solid var(--arc-border);
    background: var(--arc-surface-2);
    border-radius: var(--arc-r-sm);
    color: var(--arc-text-soft);
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s;
  }
  .mini:hover {
    border-color: var(--arc-primary);
    color: var(--arc-primary);
  }
  .mini.danger:hover {
    border-color: var(--arc-danger);
    color: var(--arc-danger);
  }

  /* Modal */
  .m-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(23, 26, 33, 0.4);
    backdrop-filter: blur(1.5px);
    z-index: 60;
  }
  .m-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 61;
    width: 460px;
    max-width: 94vw;
    max-height: 88vh;
    overflow-y: auto;
    background: var(--arc-surface);
    border-radius: var(--arc-r-lg);
    box-shadow: var(--arc-shadow-lg);
    display: flex;
    flex-direction: column;
  }
  .m-head {
    padding: 16px 18px;
    border-bottom: 1px solid var(--arc-border);
    font-size: 15px;
    font-weight: 600;
    color: var(--arc-text);
  }
  .m-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 11px;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row > span {
    font-size: 11px;
    font-weight: 600;
    color: var(--arc-text-soft);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .row input,
  .row select,
  .row textarea {
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    padding: 8px 10px;
    font: inherit;
    font-size: 13px;
    color: var(--arc-text);
    background: var(--arc-surface-2);
    outline: none;
  }
  .row input:focus,
  .row select:focus,
  .row textarea:focus {
    border-color: var(--arc-primary);
    box-shadow: 0 0 0 3px var(--arc-primary-soft);
  }
  .row2 {
    display: flex;
    gap: 10px;
  }
  .row2 .row {
    flex: 1;
  }
  .row2 .row.narrow {
    flex: 0 0 90px;
  }
  .m-foot {
    padding: 12px 18px;
    border-top: 1px solid var(--arc-border);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn-cancel,
  .btn-ok {
    border: 1px solid var(--arc-border);
    background: var(--arc-surface-2);
    color: var(--arc-text-soft);
    border-radius: var(--arc-r-sm);
    padding: 7px 16px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .btn-cancel:hover {
    border-color: var(--arc-text-soft);
    color: var(--arc-text);
  }
  .btn-ok {
    background: var(--arc-primary);
    color: #fff;
    border-color: var(--arc-primary);
  }
  .btn-ok:hover:not(:disabled) {
    background: var(--arc-primary-hover);
  }
  .btn-ok:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
