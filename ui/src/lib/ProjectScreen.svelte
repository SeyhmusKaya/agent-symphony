<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import {
    ProjectSession,
    type Attachment,
  } from "$lib/store.svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import Badge from "$lib/ui/Badge.svelte";
  import { EFFORTS } from "$lib/router/helpers.js";
  import Button from "$lib/ui/Button.svelte";
  import Avatar from "$lib/ui/Avatar.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import ChatThread from "$lib/ui/ChatThread.svelte";
  import { renderMarkdown } from "$lib/markdown";
  import ToolDetailPanel from "$lib/ui/ToolDetailPanel.svelte";
  import SessionsRail from "$lib/ui/SessionsRail.svelte";
  import ChiefToolbar from "$lib/ui/ChiefToolbar.svelte";
  import Composer from "$lib/ui/Composer.svelte";
  import { loadDraft, saveDraft, loadEkler, saveEkler } from "$lib/ui/draft";
  import { notifyAgentIdle } from "$lib/notify";
  import RollbackBanner from "$lib/ui/RollbackBanner.svelte";
  import AgentCard from "$lib/project/AgentCard.svelte";
  import HelperCard from "$lib/project/HelperCard.svelte";
  import WorkerStrip from "$lib/project/WorkerStrip.svelte";
  import JobMonitor from "$lib/autonomous/JobMonitor.svelte";
  import {
    fmtTokens,
    fmtElapsedShort,
    readFile,
  } from "$lib/project/helpers.js";
  import {
    listProjects,
    listServers,
    setProjectDeployment,
    type Deployment,
    type Server,
  } from "$lib/api";

  let {
    projectId,
    projectName,
    port,
    onBack,
    active = true,
    onActivityChange,
  }: {
    projectId: string;
    projectName: string;
    port: number;
    onBack: () => void;
    active?: boolean;
    onActivityChange?: (state: "busy" | "idle") => void;
  } = $props();

  // Deploy state — needed for the quick-select server button in the header.
  let depMode = $state<"local" | "remote" | "hibrit">("local");
  let depServerIds = $state<string[]>([]);
  let depScript = $state("");
  let depPublicUrl = $state("");
  let depServers = $state<Server[]>([]);

  async function loadDeployment() {
    const [projects, servers] = await Promise.all([listProjects(), listServers()]);
    depServers = servers;
    const proj = projects.find((p) => p.id === projectId);
    const d = proj?.deployment;
    if (d) {
      depMode = d.mode;
      depServerIds = [...d.serverIds];
      depScript = d.deployScript ?? "";
      depPublicUrl = d.publicUrl ?? "";
    } else {
      depMode = "local";
      depServerIds = [];
      depScript = "";
      depPublicUrl = "";
    }
  }

  const session = new ProjectSession();

  // Fix 61: draft per-session.
  const draftKey = $derived(`arc:draft:proj:${port}:${session.activeSessionId || "main"}`);
  // svelte-ignore state_referenced_locally
  let draft = $state(loadDraft(`arc:draft:proj:${port}:main`));
  let ekler = $state<Attachment[]>(loadEkler(`arc:draft:proj:${port}:main`) as Attachment[]);

  let lastDraftKey = $state<string | null>(null);
  $effect(() => {
    const key = draftKey;
    if (lastDraftKey === null) {
      lastDraftKey = key;
      return;
    }
    if (lastDraftKey === key) {
      saveDraft(key, draft);
      saveEkler(key, ekler);
      return;
    }
    saveDraft(lastDraftKey, draft);
    saveEkler(lastDraftKey, ekler);
    draft = loadDraft(key);
    ekler = loadEkler(key) as Attachment[];
    lastDraftKey = key;
  });

  let expandedWorker = $state<number | null>(null);
  // Left-panel "Workers" — id of the open helper card.
  let expandedHelper = $state<string | null>(null);
  // Specialist read-only chat modal — selected specialist name (null = closed).
  let selectedAgent = $state<string | null>(null);
  const selectedAgentChat = $derived(
    selectedAgent ? (session.specialistChats[selectedAgent] ?? []) : [],
  );
  const selectedAgentMeta = $derived(
    selectedAgent ? session.agents.find((x) => x.name === selectedAgent) : undefined,
  );
  // Specialist popup chat — same rules as the normal chat window: last 200
  // messages (avoid lag), auto-scroll to the bottom, specialist reply rendered as markdown.
  const MAX_UZ_MSG = 200;
  const shownAgentChat = $derived(
    selectedAgentChat.length > MAX_UZ_MSG
      ? selectedAgentChat.slice(-MAX_UZ_MSG)
      : selectedAgentChat,
  );
  let uzBodyEl = $state<HTMLDivElement | null>(null);
  let expandedTasks = $state<Set<number>>(new Set());
  function toggleTask(ts: number) {
    const s = new Set(expandedTasks);
    if (s.has(ts)) s.delete(ts);
    else s.add(ts);
    expandedTasks = s;
  }
  function fmtClock(ts: number): string {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }
  // When the popup opens / a new message arrives, scroll the chat to the bottom (like the normal chat).
  $effect(() => {
    void selectedAgent;
    void shownAgentChat.length;
    const el = uzBodyEl;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  });

  // F1.2 (Option B): the direct specialist-chat UX was completely removed. Selected
  // state + agentDraft + agentEkler + selectedAgent + agentChat + specialistLive
  // + specialistElapsed + selectAgent + sendAgentDraft were all deleted. The chief
  // spawns specialists via the Agent tool; the UI does not communicate directly with specialists.
  // The left-panel specialist cards are read-only (readOnly=true).

  const pendingCount = $derived(session.queue.filter((q) => q.status === "bekliyor").length);
  // Workers list — cached via $derived; recomputed only when chat/canliAktivite
  // change (no scan on every render in a long chat).
  const helpers = $derived(session.helpers);

  // For the round dot on the left-panel specialist card.
  function agentHasActivity(name: string): boolean {
    const a = session.agents.find((x) => x.name === name);
    if (a?.transcript) return true;
    return session.feed.some(
      (e) =>
        (e.payload.agent === name || e.payload.peer === name) &&
        (e.type === "delege_basladi" ||
          e.type === "delege_bitti" ||
          e.type === "ajan_transcript" ||
          e.type === "peer_istek"),
    );
  }

  const composerActivityLabel = $derived.by(() => {
    if (!session.runningHere) return "";
    const aktif = session.canliAktivite.find((a) => a.durum === "calisiyor");
    const isim = aktif ? aktif.ad : "Thinking";
    return `${isim} · ${fmtElapsedShort(session.runElapsed)} · in ${fmtTokens(session.liveIn)} / out ${fmtTokens(session.liveOut)}`;
  });

  let recording = $state(false);
  let speechAvailable = $state(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recognition: any = null;

  function setupSpeech() {
    const w = window as unknown as Record<string, unknown>;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    speechAvailable = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new (Ctor as any)();
    rec.lang = "tr-TR";
    rec.interimResults = true;
    rec.continuous = true;
    let base = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }
      draft = (base ? base + " " : "") + text;
    };
    rec.onstart = () => {
      base = draft.trim();
      recording = true;
    };
    rec.onend = () => {
      recording = false;
    };
    rec.onerror = () => {
      recording = false;
    };
    recognition = rec;
  }

  function toggleMic() {
    if (!recognition) return;
    if (recording) recognition.stop();
    else recognition.start();
  }

  function sendDraft() {
    const text = draft.trim();
    if (!text) return;
    session.sendCommand(text, ekler);
    draft = "";
    ekler = [];
  }

  async function addFiles(files: File[]) {
    for (const f of files) {
      try {
        ekler = [...ekler, await readFile(f)];
      } catch {
        /* skip */
      }
    }
  }

  async function onFiles(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files) return;
    await addFiles(Array.from(input.files));
    input.value = "";
  }

  function removeEk(i: number) {
    ekler = ekler.filter((_, idx) => idx !== i);
  }

  function addAgent() {
    const name = prompt("Specialist name:");
    if (!name) return;
    const role = prompt("Specialist role / responsibility:") ?? "";
    session.sendCommand(`Create new specialist. Name: ${name}. Role: ${role}.`);
  }

  function onGlobalKey(e: KeyboardEvent) {
    if (e.key === "F3") {
      e.preventDefault();
      toggleMic();
    }
  }

  // Chief reply notification — ONLY on the sef_tamamen_idle event.
  $effect(() => {
    const running = session.running;
    untrack(() => onActivityChange?.(running ? "busy" : "idle"));
  });

  let prevIdleSig = 0;
  $effect(() => {
    const sig = session.tamamenIdleSignal;
    if (sig > prevIdleSig) {
      prevIdleSig = sig;
      const lastMsg = session.chat[session.chat.length - 1];
      const body =
        lastMsg && lastMsg.role === "sef"
          ? lastMsg.text
          : "Task completed.";
      void notifyAgentIdle({
        agentName: `${projectName} Chief`,
        agentKey: projectId,
        lastMessage: body,
        elapsedMs: session.runElapsed,
        liveIn: session.liveIn,
        liveOut: session.liveOut,
        forceShow: !active,
      });
    } else if (sig < prevIdleSig) {
      prevIdleSig = sig;
    }
  });

  onMount(() => {
    session.agentDisplayName = `${projectName} Chief`;
    session.connect(port);
    setupSpeech();
    void loadDeployment();
    window.addEventListener("keydown", onGlobalKey);
    return () => window.removeEventListener("keydown", onGlobalKey);
  });

  // P1.33: quick server selection in the header.
  async function setQuickServer(serverId: string): Promise<void> {
    if (!serverId) {
      depMode = "local";
      depServerIds = [];
    } else {
      depMode = "remote";
      depServerIds = [serverId];
    }
    const dep: Deployment = {
      mode: depMode,
      serverIds: depServerIds,
      deployScript: depScript.trim() || undefined,
      publicUrl: depPublicUrl.trim() || undefined,
    };
    try {
      await setProjectDeployment(projectId, dep);
    } catch {
      /* ignore */
    }
  }

  onDestroy(() => session.dispose());
</script>

<div class="window">
  <header class="topbar">
    <div class="tb-left">
      <Button variant="icon" icon="x" title="Close window" onclick={onBack} />
      <div class="tb-divider"></div>
      <Avatar label={projectName} size={34} variant="gradient" />
      <div class="tb-id">
        <span class="arc-caption">Project</span>
        <div class="tb-name">{projectName}</div>
      </div>
      <Badge variant="soft" tone={session.connected ? "ok" : "warn"} dot pulse={!session.connected}>
        {session.connected ? "Connected" : "Connecting…"}
      </Badge>
      <!-- P1.33: quick server selection. -->
      <label class="srv-pick" title="This project's deploy/SSH target">
        <Icon name="server" size={14} stroke={2} />
        <select
          value={depServerIds[0] ?? ""}
          onchange={(e) => setQuickServer((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">No server</option>
          {#each depServers as s (s.id)}
            <option value={s.id}>{s.name}</option>
          {/each}
        </select>
      </label>
    </div>

    <ChiefToolbar {session} />
  </header>

  <div class="panels">
    <!-- LEFT — Specialists -->
    <aside class="panel left">
      <div class="panel-head">
        <div class="panel-head-l">
          <Icon name="users" size={14} class="panel-head-ic" />
          <span class="arc-caption">Specialists</span>
          <span class="head-count">{session.agents.length}</span>
        </div>
        <Button variant="ghost" size="sm" icon="plus" onclick={addAgent} />
      </div>
      <div class="panel-body">
        {#if session.agents.length === 0}
          <EmptyState
            icon="users"
            title="No specialists"
            text="The chief will create specialists as needed."
            compact
          />
        {:else}
          {#each session.agents as a (a.name)}
            <AgentCard
              agent={a}
              selected={selectedAgent === a.name}
              hasActivity={agentHasActivity(a.name)}
              onSelect={(n) => (selectedAgent = n)}
              readOnly={false}
            />
          {/each}
        {/if}

        <!-- Workers — temporary helpers produced by the chief (native Agent
             subagent + task worker). Derived from chat+canliAktivite; persistent. -->
        {#if helpers.length > 0}
          <div class="sub-head">
            <Icon name="zap" size={12} class="panel-head-ic" />
            <span class="arc-caption">Tasks</span>
            <span class="head-count">{helpers.length}</span>
          </div>
          <div class="helpers-list">
            {#each helpers as h (h.id)}
              <HelperCard
                helper={h}
                now={session.nowTick}
                expanded={expandedHelper === h.id}
                onToggle={() => (expandedHelper = expandedHelper === h.id ? null : h.id)}
              />
            {/each}
          </div>
        {/if}
      </div>
    </aside>

    <!-- CENTER — Chief chat (F1.2 Option B: the direct specialist chat screen was removed) -->
    <section class="panel center">
      <div class="panel-head">
        <div class="panel-head-l">
          <Icon name="message" size={14} class="panel-head-ic" />
          <span class="arc-caption">Chief chat</span>
        </div>
        {#if pendingCount > 0}
          <Badge variant="soft" tone="warn" icon="inbox">{pendingCount} in queue</Badge>
        {/if}
      </div>

      <RollbackBanner
        info={session.autoRollback}
        dismissedTs={session.rollbackDismissedTs}
        onDismiss={() => session.dismissRollback()}
      />

      <ChatThread
        messages={session.chat}
        running={session.thinking}
        aktivite={session.canliAktivite}
        elapsed={session.runElapsed}
        tokens={session.runTokens}
        liveIn={session.liveIn}
        liveOut={session.liveOut}
        liveCacheRead={session.liveCacheRead}
        liveCacheCreate={session.liveCacheCreate}
        liveUncached={session.liveUncached}
        liveUsd={session.liveUsd}
        runError={session.runError}
        backgroundBusy={session.backgroundBusy}
        agentName="Chief"
        emptyIcon="message"
        emptyTitle="No commands yet"
        emptyText="Give the chief its first command to begin."
        onCevaplaSoru={(c) => session.cevaplaSoru(c)}
        onInspectTool={(t) => session.openToolDetail(t)}
      />
      <ToolDetailPanel detail={session.selectedTool} onClose={() => session.closeToolDetail()} />

      <div class="composer-host">
        {#if session.ajanSoru}
          <div class="ask-pending-badge" role="status">
            <Icon name="message" size={11} stroke={2.4} />
            <span>Agent question waiting — answer above</span>
          </div>
        {/if}
        <Composer
          bind:draft
          attachments={ekler}
          disabled={!session.connected}
          placeholder={session.connected ? "Write a command for the chief…" : "Reconnecting… cannot send yet"}
          {speechAvailable}
          {recording}
          running={session.runningHere}
          activityLabel={composerActivityLabel}
          onSend={sendDraft}
          onStop={() => session.control("durdur")}
          onPause={() => session.control("duraklat")}
          {onFiles}
          onPaste={addFiles}
          onRemoveAttachment={removeEk}
          onToggleMic={toggleMic}
        />
      </div>
    </section>

    <!-- RIGHT — Sessions + Between Chiefs + Autonomous Jobs (F3) -->
    <aside class="panel right">
      <SessionsRail
        {session}
        agentLabel={projectName}
        storageKey={`chief:${projectId}`}
      />
      <!-- F3: active/completed autonomous jobs. Shown only if there are jobs;
           does not take space in an empty project. -->
      {#if session.autonomousJobs.length > 0}
        <JobMonitor
          jobs={session.autonomousJobs}
          onPause={(id) => session.pauseAutonomousJob(id)}
          onResume={(id) => session.resumeAutonomousJob(id)}
          onCancel={(id) => session.cancelAutonomousJob(id)}
        />
      {/if}
    </aside>
  </div>

  <WorkerStrip
    workers={session.workers}
    {expandedWorker}
    onToggle={(id) => (expandedWorker = id)}
  />

  <!-- Specialist read-only chat modal. The task the chief delegated via the Agent
       tool (ajan_komut) + the specialist's reply (uzman). Read-only — no input box
       (the native Agent specialist is ephemeral, no persistent chat process). -->
  {#if selectedAgent}
    <div
      class="uz-overlay"
      role="button"
      tabindex="0"
      onclick={() => (selectedAgent = null)}
      onkeydown={(e) => e.key === "Escape" && (selectedAgent = null)}
    >
      <div
        class="uz-modal"
        role="dialog"
        aria-modal="true"
        tabindex="0"
        onclick={(e) => e.stopPropagation()}
        onkeydown={() => {}}
      >
        <header class="uz-head">
          <div class="uz-head-id">
            <div class="uz-name">{selectedAgent}</div>
            {#if selectedAgentMeta}
              <div class="uz-role">{selectedAgentMeta.role}</div>
            {/if}
          </div>
          <button class="uz-close" title="Close" onclick={() => (selectedAgent = null)}>✕</button>
        </header>
        {#if selectedAgentMeta}
          <div class="uz-ctrl">
            <div class="uz-ctrl-row">
              <label class="uz-field">
                <span class="uz-flabel">Model</span>
                <select
                  class="uz-select"
                  value={selectedAgentMeta.model}
                  onchange={(e) =>
                    selectedAgent &&
                    session.setAgentModel(
                      selectedAgent,
                      (e.currentTarget as HTMLSelectElement).value,
                      selectedAgentMeta.effort,
                    )}
                >
                  {#each session.availableModels as m (m)}
                    <option value={m}>{m}</option>
                  {/each}
                </select>
              </label>
              <label class="uz-field">
                <span class="uz-flabel">Effort</span>
                <select
                  class="uz-select"
                  value={selectedAgentMeta.effort}
                  onchange={(e) =>
                    selectedAgent &&
                    session.setAgentModel(
                      selectedAgent,
                      selectedAgentMeta.model,
                      (e.currentTarget as HTMLSelectElement).value,
                    )}
                >
                  {#each EFFORTS as ef (ef)}
                    <option value={ef}>{ef}</option>
                  {/each}
                </select>
              </label>
            </div>
            {#if selectedAgentMeta.skills?.length}
              <div class="uz-skills">
                <span class="uz-flabel">Skills</span>
                {#each selectedAgentMeta.skills as s (s)}
                  <Badge variant="soft" tone="neutral">{s}</Badge>
                {/each}
              </div>
            {/if}
            <div class="uz-hint">
              Fast mode is not specialist-specific — the specialist shares the proxy layer the chief runs on.
              A model/effort change takes effect on the next <code>Agent</code> call.
            </div>
          </div>
        {/if}
        <div class="uz-body" bind:this={uzBodyEl}>
          {#if shownAgentChat.length === 0}
            <div class="uz-empty">
              No recorded tasks yet. When the chief assigns a task to this specialist via <code>Agent</code>,
              the task it sent and the specialist's reply appear here (read-only).
            </div>
          {:else}
            {#each shownAgentChat as m (m.ts)}
              {@const isUzman = m.role === "uzman"}
              {@const isLong = (m.text?.length ?? 0) > 360}
              {@const collapsed = isLong && !expandedTasks.has(m.ts)}
              <div class="uz-msg" class:uzman={isUzman} class:err={m.hata}>
                <div class="uz-msg-head">
                  <span class="uz-msg-role">
                    {isUzman ? selectedAgent : (m.fromAgent ?? "Chief") + " → task"}
                  </span>
                  <span class="uz-msg-time">{fmtClock(m.ts)}</span>
                </div>
                {#if isUzman}
                  <!-- Specialist reply rendered as markdown (clean instead of raw ##/**/---).
                       Long replies now collapse too (parity with the task bubble). -->
                  {#if collapsed}
                    <div class="uz-msg-text md">{@html renderMarkdown(m.text.slice(0, 360) + " …")}</div>
                    <button class="uz-more" onclick={() => toggleTask(m.ts)}>Show all</button>
                  {:else}
                    <div class="uz-msg-text md">{@html renderMarkdown(m.text)}</div>
                    {#if isLong}
                      <button class="uz-more" onclick={() => toggleTask(m.ts)}>Collapse</button>
                    {/if}
                  {/if}
                {:else if collapsed}
                  <!-- Chief task is very long — truncate + "Show all". -->
                  <div class="uz-msg-text uz-task">{m.text.slice(0, 360)}…</div>
                  <button class="uz-more" onclick={() => toggleTask(m.ts)}>Show all</button>
                {:else}
                  <div class="uz-msg-text uz-task">{m.text}</div>
                  {#if isLong}
                    <button class="uz-more" onclick={() => toggleTask(m.ts)}>Collapse</button>
                  {/if}
                {/if}
                {#if m.transcript}
                  <pre class="uz-msg-tr">{m.transcript}</pre>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
        <footer class="uz-foot">
          Read-only · the specialist is run by the chief via the native Agent tool
        </footer>
      </div>
    </div>
  {/if}
</div>

<style>
  .window {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--arc-bg);
  }
  /* Specialist read-only chat modal */
  .uz-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: color-mix(in srgb, #0b1220 55%, transparent);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .uz-modal {
    width: min(760px, 92vw);
    max-height: 84vh;
    display: flex;
    flex-direction: column;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: 14px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
    overflow: hidden;
  }
  .uz-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    background: linear-gradient(135deg, var(--arc-primary, #0F766E), color-mix(in srgb, var(--arc-primary, #0F766E) 70%, #0b1220));
    color: #fff;
  }
  .uz-head-id { flex: 1; min-width: 0; }
  .uz-name { font-size: 15px; font-weight: 700; letter-spacing: 0.2px; }
  .uz-role { font-size: 12px; opacity: 0.85; }
  .uz-close {
    border: none;
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.15s;
  }
  .uz-close:hover { background: rgba(255, 255, 255, 0.3); }
  .uz-ctrl {
    padding: 12px 18px;
    border-bottom: 1px solid var(--arc-border);
    background: var(--arc-surface);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .uz-ctrl-row { display: flex; gap: 12px; flex-wrap: wrap; }
  .uz-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 160px; }
  .uz-flabel {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--arc-text-soft);
  }
  .uz-select {
    appearance: none;
    border: 1px solid var(--arc-border);
    border-radius: 8px;
    background: var(--arc-bg);
    color: var(--arc-text);
    padding: 7px 10px;
    font-size: 13px;
    font-family: var(--arc-mono, monospace);
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .uz-select:hover, .uz-select:focus { border-color: var(--arc-primary, #0F766E); outline: none; }
  .uz-skills { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .uz-hint {
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--arc-text-soft);
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 6%, var(--arc-bg));
    border: 1px solid var(--arc-border);
    border-radius: 8px;
    padding: 7px 10px;
  }
  .uz-hint code {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: 4px;
    padding: 0 4px;
    font-size: 11px;
  }
  .uz-body {
    flex: 1;
    overflow-y: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--arc-bg);
  }
  .uz-empty {
    color: var(--arc-text-soft);
    font-size: 13px;
    line-height: 1.6;
    text-align: center;
    padding: 28px 16px;
  }
  .uz-empty code {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 12px;
  }
  .uz-msg {
    align-self: flex-start;
    max-width: 88%;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: 12px;
    border-top-left-radius: 4px;
    padding: 10px 13px;
    box-shadow: var(--arc-shadow-sm);
  }
  .uz-msg.uzman {
    align-self: flex-end;
    border-top-left-radius: 12px;
    border-top-right-radius: 4px;
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 10%, var(--arc-surface));
    border-color: color-mix(in srgb, var(--arc-primary, #0F766E) 30%, var(--arc-border));
  }
  .uz-msg.err {
    border-color: color-mix(in srgb, var(--arc-danger) 40%, var(--arc-border));
    background: color-mix(in srgb, var(--arc-danger) 7%, var(--arc-surface));
  }
  .uz-msg-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 5px;
  }
  .uz-msg-role {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--arc-text-soft);
  }
  .uz-msg.uzman .uz-msg-role { color: var(--arc-primary, #0F766E); }
  .uz-msg-time {
    font-size: 10px;
    color: var(--arc-text-faint);
    font-family: var(--arc-mono, monospace);
    flex-shrink: 0;
  }
  .uz-msg-text {
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--arc-text);
    word-break: break-word;
  }
  /* Chief task = plain text, line structure preserved. */
  .uz-task {
    white-space: pre-wrap;
    color: var(--arc-text-soft);
    font-size: 12.5px;
  }
  /* "Show all / Collapse" button. */
  .uz-more {
    margin-top: 6px;
    background: transparent;
    border: 1px solid var(--arc-border);
    border-radius: 6px;
    padding: 2px 9px;
    font-size: 10.5px;
    font-weight: 600;
    color: var(--arc-primary, #0F766E);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .uz-more:hover {
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 8%, transparent);
    border-color: var(--arc-primary, #0F766E);
  }
  /* Specialist reply markdown — clean typography (instead of raw markdown marks). */
  .uz-msg-text.md :global(h1),
  .uz-msg-text.md :global(h2),
  .uz-msg-text.md :global(h3) {
    font-size: 14px;
    font-weight: 700;
    margin: 10px 0 5px;
    color: var(--arc-text);
  }
  .uz-msg-text.md :global(p) { margin: 6px 0; }
  .uz-msg-text.md :global(ul),
  .uz-msg-text.md :global(ol) { margin: 6px 0; padding-left: 20px; }
  .uz-msg-text.md :global(li) { margin: 2px 0; }
  .uz-msg-text.md :global(code) {
    font-family: var(--arc-mono, monospace);
    font-size: 12px;
    background: var(--arc-bg);
    border: 1px solid var(--arc-border);
    border-radius: 4px;
    padding: 1px 5px;
  }
  .uz-msg-text.md :global(pre) {
    background: var(--arc-bg);
    border: 1px solid var(--arc-border);
    border-radius: 8px;
    padding: 9px 11px;
    overflow: auto;
    margin: 7px 0;
  }
  .uz-msg-text.md :global(pre code) { border: none; background: transparent; padding: 0; }
  .uz-msg-text.md :global(hr) {
    border: none;
    border-top: 1px solid var(--arc-border);
    margin: 10px 0;
  }
  .uz-msg-text.md :global(strong) { font-weight: 700; }
  .uz-msg-text.md :global(a) { color: var(--arc-primary, #0F766E); }
  .uz-msg-tr {
    margin: 8px 0 0;
    padding: 8px 10px;
    background: var(--arc-bg);
    border: 1px solid var(--arc-border);
    border-radius: 8px;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 240px;
    overflow: auto;
  }
  .uz-foot {
    padding: 9px 18px;
    font-size: 11px;
    color: var(--arc-text-soft);
    border-top: 1px solid var(--arc-border);
    background: var(--arc-surface);
    text-align: center;
  }

  /* ---- Topbar ---- */
  .topbar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 16px;
    height: 52px;
    background: var(--arc-surface);
    border-bottom: 1px solid var(--arc-border);
  }
  .tb-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .tb-divider {
    width: 1px;
    height: 22px;
    background: var(--arc-border);
    flex-shrink: 0;
  }
  .tb-id {
    min-width: 0;
  }
  .tb-id .arc-caption {
    font-size: 9px;
    letter-spacing: 0.08em;
    color: var(--arc-text-faint);
  }
  .tb-name {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--arc-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
    line-height: 1.2;
    margin-top: 1px;
  }

  /* P1.33: header server selector */
  .srv-pick {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 9px 0 11px;
    background: var(--arc-n100);
    border-radius: var(--arc-r-sm);
    color: var(--arc-text-soft);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s var(--arc-ease), color 0.15s var(--arc-ease);
  }
  .srv-pick:hover { color: var(--arc-text); }
  .srv-pick select {
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    outline: none;
    padding: 0;
    appearance: none;
    -webkit-appearance: none;
    padding-right: 14px;
    background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
                      linear-gradient(135deg, currentColor 50%, transparent 50%);
    background-position: calc(100% - 7px) center, calc(100% - 3px) center;
    background-size: 4px 4px, 4px 4px;
    background-repeat: no-repeat;
  }

  /* ---- Panels ---- */
  .panels {
    flex: 1;
    display: grid;
    grid-template-columns: 272px 1fr 272px;
    gap: 1px;
    background: var(--arc-border);
    min-height: 0;
  }
  .panel {
    background: var(--arc-bg);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .panel.center {
    background: var(--arc-chat-bg);
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 11px 13px;
    border-bottom: 1px solid var(--arc-border);
    background: var(--arc-surface);
    flex-shrink: 0;
    min-height: 49px;
  }
  .panel-head-l {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .panel-head :global(.panel-head-ic) {
    color: var(--arc-primary);
  }
  .head-count {
    font-size: 11px;
    font-weight: 600;
    font-family: var(--arc-mono);
    color: var(--arc-text-faint);
    background: var(--arc-n100);
    border-radius: var(--arc-r-pill);
    padding: 2px 8px;
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  /* Left-panel inner divider heading — for sub-groups like "Workers". */
  .sub-head {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 6px;
    padding-top: 11px;
    border-top: 1px solid var(--arc-border);
  }
  .sub-head :global(.panel-head-ic) {
    color: var(--arc-primary);
  }
  .helpers-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* ---- Composer host ---- */
  .composer-host {
    flex-shrink: 0;
    padding: 12px 20px;
    border-top: 1px solid var(--arc-border);
    background: var(--arc-chat-bg);
  }
  .ask-pending-badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 8px;
    padding: 5px 11px;
    border-radius: var(--arc-r-pill);
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    border: 1px solid var(--arc-primary);
    animation: ask-pulse 1.8s ease-in-out infinite;
  }
  @keyframes ask-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--arc-primary, #0F766E) 28%, transparent); }
    50% { box-shadow: 0 0 0 6px transparent; }
  }
</style>
