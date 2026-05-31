<script lang="ts">
  import { onMount } from "svelte";
  import { relay, type FeedEvent } from "./relay.svelte";

  let tab = $state<"sohbet" | "uzmanlar" | "akis">("sohbet");
  let draft = $state("");
  let recording = $state(false);
  let speechAvailable = $state(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recognition: any = null;

  const EVENT_LABEL: Record<string, string> = {
    delege_basladi: "Delege başladı",
    delege_bitti: "Delege bitti",
    worker_spawn: "Worker başladı",
    worker_done: "Worker bitti",
    peer_istek: "Uzman isteği",
    commit: "Commit",
    hata: "Hata",
    token_guncelleme: "Token",
    ajan_durum_degisti: "Ajan durumu",
    dosya_degisti: "Dosya değişti",
  };

  const STATUS_LABEL: Record<string, string> = {
    bos: "Boşta",
    calisiyor: "Çalışıyor",
    hata: "Hata",
  };

  function fmtTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  }

  function fmtTime(ts: number): string {
    return new Date(ts).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  }

  function eventText(ev: FeedEvent): string {
    const p = ev.payload;
    if (ev.type === "commit") return `${p.hash} — ${p.mesaj}`;
    if (ev.type === "hata") return String(p.mesaj ?? "");
    if (p.agent) return String(p.agent) + (p.task ? ` — ${p.task}` : "");
    if (p.task) return String(p.task);
    return "";
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    relay.sendCommand(text);
    draft = "";
  }

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
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      draft = (base ? base + " " : "") + text;
    };
    rec.onstart = () => {
      base = draft.trim();
      recording = true;
    };
    rec.onend = () => (recording = false);
    rec.onerror = () => (recording = false);
    recognition = rec;
  }

  function toggleMic() {
    if (!recognition) return;
    if (recording) recognition.stop();
    else recognition.start();
  }

  onMount(setupSpeech);
</script>

<div class="view">
  <header class="bar">
    <button class="back" onclick={() => relay.leaveProject()} aria-label="Geri">‹</button>
    <div class="title">{relay.activeProject?.name ?? "Proje"}</div>
    <div class="tok">↑{fmtTokens(relay.tokensIn)} ↓{fmtTokens(relay.tokensOut)}</div>
  </header>

  <nav class="tabs">
    <button class:active={tab === "sohbet"} onclick={() => (tab = "sohbet")}>Sohbet</button>
    <button class:active={tab === "uzmanlar"} onclick={() => (tab = "uzmanlar")}>
      Uzmanlar {relay.agents.length ? `(${relay.agents.length})` : ""}
    </button>
    <button class:active={tab === "akis"} onclick={() => (tab = "akis")}>
      Akış {relay.feed.length ? `(${relay.feed.length})` : ""}
    </button>
  </nav>

  {#if tab === "sohbet"}
    <div class="chat">
      {#if relay.chat.length === 0}
        <p class="empty">Şefe ilk komutunu ver.</p>
      {:else}
        {#each relay.chat as m (m.ts)}
          <div class="msg {m.role}">
            <div class="bubble">{m.text}</div>
            <div class="mtime">{fmtTime(m.ts)}</div>
          </div>
        {/each}
      {/if}
    </div>
    <div class="composer">
      <textarea bind:value={draft} rows="1" placeholder="Şefe komut yaz…"></textarea>
      {#if speechAvailable}
        <button class="mic" class:rec={recording} onclick={toggleMic} aria-label="Sesli mesaj">
          {recording ? "■" : "🎤"}
        </button>
      {/if}
      <button class="send" onclick={send} disabled={!draft.trim()}>Gönder</button>
    </div>
  {:else if tab === "uzmanlar"}
    <div class="scroll">
      {#if relay.agents.length === 0}
        <p class="empty">Henüz uzman yok.</p>
      {:else}
        {#each relay.agents as a (a.name)}
          <div class="agent arc-card" class:running={a.status === "calisiyor"}>
            <div class="arow">
              <div class="adot {a.status}"></div>
              <div class="aname">{a.name}</div>
              <span class="pill {a.status}">{STATUS_LABEL[a.status]}</span>
            </div>
            <div class="arole">{a.role}</div>
            <div class="badges">
              <span class="badge">{a.model}</span>
              <span class="badge soft">{a.effort}</span>
            </div>
            {#if a.task}<div class="atask">{a.task}</div>{/if}
          </div>
        {/each}
      {/if}
    </div>
  {:else}
    <div class="scroll">
      {#if relay.feed.length === 0}
        <p class="empty">Olay yok.</p>
      {:else}
        {#each relay.feed as ev (ev.uid)}
          <div class="feed {ev.type}">
            <div class="frow">
              <span class="ftype">{EVENT_LABEL[ev.type] ?? ev.type}</span>
              <span class="ftime">{fmtTime(ev.ts)}</span>
            </div>
            <div class="ftext">{eventText(ev)}</div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .view {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .bar {
    background: var(--arc-grad-header);
    color: #fff;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .back {
    background: rgba(255, 255, 255, 0.16);
    border: 1px solid rgba(255, 255, 255, 0.28);
    color: #fff;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    font-size: 20px;
    line-height: 1;
  }

  .title {
    flex: 1;
    font-weight: 800;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tok {
    font-size: 12px;
    font-weight: 700;
    opacity: 0.9;
  }

  .tabs {
    display: flex;
    background: var(--arc-surface);
    border-bottom: 1px solid var(--arc-border);
    flex-shrink: 0;
  }

  .tabs button {
    flex: 1;
    border: none;
    background: transparent;
    padding: 12px 4px;
    font-size: 12px;
    font-weight: 700;
    color: var(--arc-text-soft);
    border-bottom: 2px solid transparent;
  }

  .tabs button.active {
    color: var(--arc-primary-strong);
    border-bottom-color: var(--arc-primary);
  }

  .chat,
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .empty {
    color: var(--arc-text-faint);
    text-align: center;
    font-size: 13px;
    margin-top: 24px;
  }

  .msg {
    display: flex;
    flex-direction: column;
    max-width: 84%;
  }

  .msg.kullanici {
    align-self: flex-end;
    align-items: flex-end;
  }

  .bubble {
    padding: 9px 13px;
    border-radius: 13px;
    font-size: 14px;
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .msg.kullanici .bubble {
    background: var(--arc-primary);
    color: #fff;
    border-bottom-right-radius: 4px;
  }

  .msg.sef .bubble {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-bottom-left-radius: 4px;
  }

  .mtime {
    font-size: 10px;
    color: var(--arc-text-faint);
    margin-top: 3px;
  }

  .composer {
    flex-shrink: 0;
    border-top: 1px solid var(--arc-border);
    background: var(--arc-surface);
    padding: 9px;
    padding-bottom: calc(9px + env(safe-area-inset-bottom));
    display: flex;
    gap: 7px;
    align-items: flex-end;
  }

  .composer textarea {
    flex: 1;
    resize: none;
    border: 1px solid var(--arc-border);
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 15px;
    outline: none;
    max-height: 110px;
  }

  .composer textarea:focus {
    border-color: var(--arc-primary);
  }

  .mic,
  .send {
    border-radius: 10px;
    border: none;
    font-weight: 700;
    font-size: 14px;
    padding: 11px 14px;
  }

  .mic {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
  }

  .mic.rec {
    background: var(--arc-danger);
    border-color: var(--arc-danger);
    color: #fff;
  }

  .send {
    background: var(--arc-primary);
    color: #fff;
  }

  .send:disabled {
    opacity: 0.5;
  }

  .agent {
    padding: 12px;
    border-left: 3px solid transparent;
  }

  .agent.running {
    border-left-color: var(--arc-accent);
  }

  .arow {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .adot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--arc-text-faint);
  }

  .adot.calisiyor {
    background: var(--arc-accent);
  }

  .adot.hata {
    background: var(--arc-danger);
  }

  .aname {
    font-weight: 700;
    font-size: 14px;
    flex: 1;
  }

  .pill {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 20px;
    background: var(--arc-surface-2);
    color: var(--arc-text-soft);
  }

  .pill.calisiyor {
    background: rgba(20, 184, 166, 0.16);
    color: var(--arc-primary-strong);
  }

  .pill.hata {
    background: var(--arc-danger-soft);
    color: var(--arc-danger);
  }

  .arole {
    font-size: 12px;
    color: var(--arc-text-soft);
    margin: 5px 0 8px;
  }

  .badges {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }

  .badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 6px;
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
  }

  .badge.soft {
    background: var(--arc-surface-2);
    color: var(--arc-text-soft);
    border: 1px solid var(--arc-border);
  }

  .atask {
    margin-top: 8px;
    font-size: 11px;
    color: var(--arc-text-soft);
    background: var(--arc-surface-2);
    border-radius: 6px;
    padding: 6px 8px;
  }

  .feed {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-left: 3px solid var(--arc-border);
    border-radius: 8px;
    padding: 8px 10px;
  }

  .feed.delege_basladi,
  .feed.worker_spawn {
    border-left-color: var(--arc-accent);
  }

  .feed.commit {
    border-left-color: var(--arc-primary);
  }

  .feed.hata {
    border-left-color: var(--arc-danger);
  }

  .frow {
    display: flex;
    justify-content: space-between;
  }

  .ftype {
    font-size: 11px;
    font-weight: 700;
  }

  .ftime {
    font-size: 10px;
    color: var(--arc-text-faint);
  }

  .ftext {
    font-size: 12px;
    color: var(--arc-text-soft);
    margin-top: 2px;
    word-break: break-word;
  }
</style>
