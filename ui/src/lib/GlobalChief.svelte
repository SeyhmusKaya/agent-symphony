<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ProjectSession, type Attachment } from "$lib/store.svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import Avatar from "$lib/ui/Avatar.svelte";
  import ChatThread from "$lib/ui/ChatThread.svelte";
  import ToolDetailPanel from "$lib/ui/ToolDetailPanel.svelte";
  import SessionsRail from "$lib/ui/SessionsRail.svelte";
  import Composer from "$lib/ui/Composer.svelte";
  import ChiefToolbar from "$lib/ui/ChiefToolbar.svelte";
  import { agentIcon } from "$lib/ui/agentVisual";
  import { loadDraft, saveDraft, loadEkler, saveEkler } from "$lib/ui/draft";
  import RollbackBanner from "$lib/ui/RollbackBanner.svelte";

  interface Props {
    agentName?: string;
    agentPort?: number;
    mark?: string;
    subtitle?: string;
    hint?: string;
    session?: ProjectSession;
    active?: boolean;
  }
  const {
    agentName = "Architect",
    agentPort = 4316,
    subtitle = "Coordinates all projects",
    hint = "Ask about your projects or give orders to a project's chief.",
    session: externalSession,
    active = true,
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  const session = externalSession ?? new ProjectSession();

  // Active session name: show whichever session is selected as the subtitle.
  // Fallback: the subtitle coming from the prop (static).
  const activeSubtitle = $derived(
    session.sessions.find((s) => s.id === session.activeSessionId)?.name ?? subtitle
  );

  // Fix 61: draft per-session. The old draftKey only depended on agentName.
  // On the Mimar/advisor tabs, the composer text persisted across switches
  // between sub-sessions (Bas Mimar, test2, rate-test...). The new key includes activeSessionId.
  const draftKey = $derived(`arc:draft:gc:${agentName}:${session.activeSessionId || "main"}`);
  // svelte-ignore state_referenced_locally
  let draft = $state(loadDraft(`arc:draft:gc:${agentName}:main`));
  let ekler = $state<Attachment[]>(loadEkler(`arc:draft:gc:${agentName}:main`) as Attachment[]);

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

  function readFile(f: File): Promise<Attachment> {
    return new Promise((resolve, reject) => {
      const isImg = f.type.startsWith("image/");
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const res = String(reader.result);
        if (isImg) {
          resolve({
            ad: f.name,
            tur: "resim",
            mediaType: f.type,
            veri: res.includes(",") ? res.split(",")[1] : res,
          });
        } else {
          resolve({ ad: f.name, tur: "dosya", veri: res });
        }
      };
      if (isImg) reader.readAsDataURL(f);
      else reader.readAsText(f);
    });
  }

  async function addFiles(files: File[]) {
    for (const f of files) {
      try {
        ekler = [...ekler, await readFile(f)];
      } catch {
        /* file could not be read — skip */
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

  // Right panel (Sessions + Between Chiefs) collapse state — local UI state,
  // independent for each agent screen. If the user wants to widen the chat area,
  // the toggle closes the rail on its right.
  let sidePanelCollapsed = $state(false);

  // Voice message — browser Web Speech API (local, free).
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

  onMount(() => {
    setupSpeech();
    if (!externalSession) session.connect(agentPort);
  });
  onDestroy(() => {
    if (!externalSession) session.dispose();
  });

  function send() {
    const text = draft.trim();
    // A photo/file on its own is not accepted — for the model to interpret the
    // image, it should at least be told what to do (at least 1 character of text).
    if (!text) return;
    session.sendCommand(text, ekler);
    draft = "";
    ekler = [];
  }

  function fmtElapsed(s: number): string {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function fmtTok(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
  }

  // Reflect a live status like "Thinking · 12s · in 4.3k / out 1.2k · Bash" in
  // the composer's bottom strip. If there is an active tool show that, otherwise "Thinking".
  // P1.28: runningHere — Thinking only while the actively shown session is working.
  const composerActivityLabel = $derived.by(() => {
    if (!session.runningHere) return "";
    const aktifArac = session.canliAktivite.find((a) => a.durum === "calisiyor");
    const isim = aktifArac ? aktifArac.ad : "Thinking";
    const sure = fmtElapsed(session.runElapsed);
    const tok = `in ${fmtTok(session.liveIn)} / out ${fmtTok(session.liveOut)}`;
    return `${isim} · ${sure} · ${tok}`;
  });
</script>

<div class="gc">
  <header class="gc-head">
    <div class="gc-id">
      <Avatar
        label={agentName}
        icon={agentIcon(agentName, subtitle)}
        image={agentName === "Architect" ? "/logo-square.png" : undefined}
        size={38}
        variant="gradient"
      />
      <div>
        <div class="gc-name">{agentName}</div>
        <div class="gc-sub">{activeSubtitle}</div>
      </div>
    </div>
    <ChiefToolbar {session} />
  </header>

  <div class="gc-body">
    <!-- Main chat column — includes the composer, does not take the side-rail width -->
    <div class="gc-main">
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
        {active}
        {agentName}
        emptyIcon={agentIcon(agentName, subtitle)}
        emptyTitle="{agentName} ready"
        emptyText={hint}
        onCevaplaSoru={(c) => session.cevaplaSoru(c)}
        onInspectTool={(t) => session.openToolDetail(t)}
      />
      <ToolDetailPanel detail={session.selectedTool} onClose={() => session.closeToolDetail()} />

      <div class="gc-composer">
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
          placeholder={session.connected ? `Message ${agentName}…` : "Reconnecting… cannot send yet"}
          {speechAvailable}
          {recording}
          running={session.runningHere}
          activityLabel={composerActivityLabel}
          onSend={send}
          onStop={() => session.control("durdur")}
          onPause={() => session.control("duraklat")}
          {onFiles}
          onPaste={addFiles}
          onRemoveAttachment={removeEk}
          onToggleMic={toggleMic}
        />
      </div>
    </div>

    <!-- Toggle button — between gc-main and gc-side-rail -->
    <button
      type="button"
      class="gc-rail-toggle"
      class:collapsed={sidePanelCollapsed}
      title={sidePanelCollapsed ? "Show side panel" : "Collapse side panel"}
      aria-label={sidePanelCollapsed ? "Open side panel" : "Collapse side panel"}
      onclick={() => (sidePanelCollapsed = !sidePanelCollapsed)}
    >
      <Icon name={sidePanelCollapsed ? "chevronLeft" : "chevronRight"} size={13} stroke={2.4} />
    </button>

    {#if !sidePanelCollapsed}
      <aside class="gc-side-rail">
        <SessionsRail
          {session}
          agentLabel={agentName}
          storageKey={agentName}
        />
      </aside>
    {/if}
  </div>
</div>

<style>
  .gc {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--arc-surface-2);
  }
  .gc-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 22px;
    height: 52px;
    background: var(--arc-surface);
    border-bottom: 1px solid var(--arc-border);
  }
  /* The header's right side (Plan/Gauge/$/Model/BgPicker) was moved into the
     ChiefToolbar component — orphan CSS classes were removed. */

  .gc-id {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .gc-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--arc-text);
    line-height: 1.2;
  }
  .gc-sub {
    font-size: 11.5px;
    color: var(--arc-text-soft);
    margin-top: 1px;
  }

  .gc-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: row;
    background: var(--arc-chat-bg);
    position: relative;
  }
  /* Main chat + composer column */
  .gc-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  /* Toggle — positioned between gc-main and gc-side-rail */
  .gc-rail-toggle {
    flex-shrink: 0;
    align-self: center;
    width: 18px;
    height: 56px;
    border-radius: 6px 0 0 6px;
    border: 1px solid var(--arc-border);
    border-right: none;
    background: var(--arc-surface);
    color: var(--arc-text-soft);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: background 0.15s var(--arc-ease), color 0.15s var(--arc-ease);
    z-index: 5;
  }
  .gc-rail-toggle.collapsed {
    border-radius: 0 6px 6px 0;
    border: 1px solid var(--arc-border);
    border-left: none;
  }
  .gc-rail-toggle:hover {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
  }
  .gc-side-rail {
    width: 272px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--arc-surface);
    border-left: 1px solid var(--arc-border);
    overflow-y: auto;
    min-height: 0;
  }
  /* Between chiefs feed — moved into SessionsRail (Fix: unified right-panel
     design). The old .gc-feed-* classes were removed. */

  .gc-composer {
    flex-shrink: 0;
    border-top: 1px solid var(--arc-border);
    background: var(--arc-chat-bg);
    padding: 12px 20px;
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
