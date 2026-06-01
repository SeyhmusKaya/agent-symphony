// ui/src/lib/store/projectSession.svelte.ts — ProjectSession class.
// Extracted from store.svelte.ts. Type definitions are in ./types.js,
// ServerMessage in ./serverMessages.js, and in the watchdog/pending helper
// modules. Class behavior is preserved one-to-one.
//
// F1.2 (Option B): the direct UI expert chat UX was removed. sendToAgent,
// specialistChats, specialistLive, uzman_* event handlers were deleted. The
// chief spawns experts via the Agent tool; the UI does not communicate with the
// expert directly.

import { notifyAgentQuestion } from "../notify";
import type {
  AgentInfo,
  AgentStatus,
  AgentView,
  AjanSoru,
  Attachment,
  AutoRollbackInfo,
  CanliAktivite,
  ChatMessage,
  ChatSegment,
  ControlAction,
  DiffEntry,
  FeedEvent,
  ProjectStatus,
  QueueItem,
  SessionInfo,
  ToolActivity,
  WorkerView,
  HelperView,
} from "./types.js";
import type { ServerMessage } from "./serverMessages.js";
import { savePending, loadPending } from "./pending.js";
import {
  type WatchdogState,
  createWatchdog,
  bumpWatchdogActivity,
  bumpWatchdogIfTokensGrew,
  resetWatchdog,
  watchdogTimeoutMessage,
} from "./watchdog.js";

export class ProjectSession {
  connected = $state(false);
  agents = $state<AgentView[]>([]);
  // Expert read-only chat history (expert name -> entry[]). The backend writes
  // Agent delegation to registry.chat, and it arrives via status.specialistChats.
  specialistChats = $state<Record<string, import("./types").SpecialistChatEntry[]>>({});
  // Workers (helper) elapsed: a now that ticks every second + helper start
  // stamps. HelperCard shows live elapsed time via now - startTs.
  nowTick = $state(Date.now());
  private helperStart = new Map<string, number>();
  queue = $state<QueueItem[]>([]);
  feed = $state<FeedEvent[]>([]);
  workers = $state<WorkerView[]>([]);
  chat = $state<ChatMessage[]>([]);
  canliAktivite = $state<CanliAktivite[]>([]);
  diffs = $state<DiffEntry[]>([]);
  // F1.2 (Option B): the specialistChats + specialistLive states were deleted.
  // The UI does not communicate with the expert directly; the chief manages it
  // via the Agent tool.
  paused = $state(false);
  planMode = $state(false);
  tokensIn = $state(0);
  tokensOut = $state(0);
  // Fix 63: running is NO LONGER $state. The backend runningSessions is
  // authoritative. The old optimistic + startRun + stopRun confusion caused
  // various stuck Thinking bugs. Now: single source runningSessions, ui derived.
  get running(): boolean {
    return this.runningHere;
  }
  // Temporary helpers produced by the chief (native Agent subagent + `task`
  // worker) are derived for the left panel "Workers" section. Source: chat
  // segments (persistent, all turns) + canliAktivite (live turn). spawn_worker
  // (anonymous Haiku) is NOT INCLUDED — those are in the lower WorkerStrip. No
  // extra backend/persistence field; since chat is persisted history stays automatically.
  get helpers(): HelperView[] {
    const map = new Map<string, HelperView>();
    const liveRunning = new Set<string>();
    for (const a of this.canliAktivite) {
      if (a.durum === "calisiyor") liveRunning.add(a.id);
    }
    const consume = (t: {
      id?: string;
      ad: string;
      girdi?: string;
      sonuc?: string;
      hata?: boolean;
      ilerleme?: string;
      tokens?: HelperView["tokens"];
    }) => {
      if (!t.id) return;
      const isAgent = t.ad === "Agent";
      const isTask = t.ad === "mcp__architect__task";
      if (!isAgent && !isTask) return;
      let label = "";
      let detail = "";
      let model: string | undefined;
      // If girdi is full JSON, parse it; in the live stream it may arrive
      // TRUNCATED (parse fails) → extract fields from the raw string with regex.
      // Old bug: when parse failed, label dropped to "gorev" (opis is actually
      // present at the start of the string).
      const raw = t.girdi ?? "";
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        parsed = null;
      }
      const pick = (key: string): string => {
        if (parsed && typeof parsed[key] === "string") return parsed[key] as string;
        const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(raw);
        return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, " ") : "";
      };
      if (isAgent) {
        label = pick("subagent_type") || "subagent";
        detail = pick("description") || pick("prompt");
      } else {
        label = pick("opis") || "task";
        detail = pick("gorev");
        model = pick("model") || undefined;
      }
      const sonuc = t.sonuc ?? "";
      const status: HelperView["status"] = t.hata
        ? "error"
        : sonuc
          ? "done"
          : liveRunning.has(t.id)
            ? "running"
            : "done";
      const prev = map.get(t.id);
      // Start stamp for elapsed: stamped the first time the helper appears as
      // "running"; preserved on done/error (the card shows elapsed in its final state).
      if (status === "running" && !this.helperStart.has(t.id)) {
        this.helperStart.set(t.id, Date.now());
      }
      map.set(t.id, {
        id: t.id,
        kind: isAgent ? "agent" : "task",
        label: label || prev?.label || (isAgent ? "subagent" : "task"),
        detail: detail || prev?.detail || "",
        model: model ?? prev?.model,
        status,
        result: sonuc || prev?.result || "",
        progress: t.ilerleme ?? prev?.progress,
        tokens: t.tokens ?? prev?.tokens,
        startTs: this.helperStart.get(t.id) ?? prev?.startTs,
      });
    };
    for (const m of this.chat) {
      if (!m.segments) continue;
      for (const seg of m.segments) {
        if (seg.kind !== "tools") continue;
        for (const t of seg.tools) consume(t);
      }
    }
    for (const a of this.canliAktivite) consume(a);
    // Running workers first, then chronological (Map insertion) order is preserved.
    return [...map.values()].sort(
      (x, y) => (x.status === "running" ? 0 : 1) - (y.status === "running" ? 0 : 1),
    );
  }
  // New state — is an autonomous (background) turn running? If true together
  // with running=true, the UI shows a small "Background work" badge instead of
  // "Thinking", and does NOT fire a notification.
  backgroundBusy = $state(false);
  // Fix 93: the selected tool for the right detail panel (when the user clicks a tool item).
  // If null the panel is closed. ToolDetailPanel.svelte reads this.
  selectedTool = $state<ToolActivity | CanliAktivite | null>(null);
  openToolDetail(t: ToolActivity | CanliAktivite): void {
    this.selectedTool = t;
  }
  closeToolDetail(): void {
    this.selectedTool = null;
  }
  // New state — signal that the last completed turn was a partial plan (UI badge).
  planYarim = $state(false);
  // New event — notification becomes true exactly ONCE here, and after firing the
  // +page.svelte effect drops it to false.
  tamamenIdleSignal = $state(0);
  runElapsed = $state(0);
  // Session switch race-guard. sessionSelect() sets this to the target id;
  // applyStatus skips the chat reconcile until status.activeSessionId === this
  // value. On match it returns to null.
  pendingSessionSwitch: string | null = $state(null);
  runTokens = $state(0);
  liveIn = $state(0);
  liveOut = $state(0);
  // PROMPT 10 — cache-aware live breakdown. Filled in the backend sef_token
  // event; LiveActivity and header badge show $.
  liveCacheRead = $state(0);
  liveCacheCreate = $state(0);
  liveUncached = $state(0);
  liveUsd = $state(0);
  sessionUsd = $state(0); // accumulated over the process lifetime
  hourlyUsd = $state(0); // M6: last 1 hour $ spend (from the status payload)
  // B: Multi-session
  sessions = $state<SessionInfo[]>([]);
  activeSessionId = $state("");
  // P1.28: which session is currently running a chief query. The UI compares
  // this with activeSessionId and shows the "Thinking" indicator only over the
  // one actually running. null = none.
  activeQuerySessionId = $state<string | null>(null);
  // P1.33: parallel sessions — multiple sessions can run at the same time.
  // runningSessions contains all active query session ids; runningHere checks
  // whether activeSessionId is in this list.
  runningSessions = $state<string[]>([]);
  // P1.29: the active session's last /clear ts. Reset local chat when it increases.
  private lastClearTsSeen = 0;
  sessionsIsGlobal = $state(false);
  liveModel = $state("");
  contextTokens = $state(0);
  runError = $state<string | null>(null);
  // Fix 134: stream-activity based "running" indicator. The backend running
  // flag (activeQueries/runningSessions) in some cases drops EARLY at turn end
  // but the SDK KEEPS producing text/tools in the same Chief block (Fix 120
  // family: "turn appears done but backend continues"). Result: the user thinks
  // it "stopped" because there is no lower "Thinking" indicator. Claude Code
  // logic: the indicator ties to live STREAM activity, not the backend flag.
  // Every streaming event (partial/activity) refreshes streamActive; it closes
  // if no new event arrives for 4s OR when a terminal event
  // (cevap/idle/tur_bitti/tamamen_idle) arrives. Self-clearing → no stuck-Thinking risk.
  streamActive = $state(false);
  private streamActiveTs = 0;
  // Restart grace period — becomes true when the restart_self event arrives; in
  // the 60s window WS disconnects are handled silently and no error is written to runError.
  restarting = $state(false);
  private restartingExpiresAt = 0;
  ajanSoru = $state<AjanSoru | null>(null);
  // Fix 104: opus always 1m, sonnet/haiku 200k — the [1m] suffix was removed.
  chiefModel = $state("claude-opus-4-8");
  chiefEffort = $state("high");
  // Fast mode (priority service tier). When active the backend proxy injects
  // service_tier:"auto" — fast if priority capacity is available, otherwise standard without error.
  chiefFast = $state(false);
  // Agent name — shown in the notification body in "<agent>: ..." format.
  // The caller (ProjectScreen, GlobalChief, +page) sets it before connect.
  agentDisplayName = $state("Agent");
  // Auto-rollback notification — the UI shows it with an orange banner. If the
  // banner is closed with X, rollbackDismissedTs is updated; the banner stays
  // hidden until a new rollback with a different ts arrives.
  autoRollback = $state<AutoRollbackInfo | null>(null);
  rollbackDismissedTs = $state(0);
  // F3 (autonomous 3-day mode): active/completed autonomous jobs. JobMonitor
  // reads this. The backend sends it in the status payload "autonomousJobs" field.
  autonomousJobs = $state<import("./types").AutonomousJob[]>([]);
  // F4 (Cost Control): live budget report — BudgetCard draws it. The backend
  // sends it in the status payload "budgets" field.
  budgets = $state<import("./types").BudgetReport | null>(null);
  // The "is autonomous" at the moment the backend emitted sef_token —
  // sef_aktivite/sef_parcali set this; used at sef_cevap completion.
  private currentTurnAuto = false;

  // Fix 104: Opus always 1M, Sonnet/Haiku always 200k. The old [1m] suffix logic
  // was removed. Same semantics as the backend chiefContextWindow().
  get contextWindow(): number {
    return /claude-opus/i.test(this.chiefModel) ? 1_000_000 : 200_000;
  }

  // P1.28: "running, but IS it running on the actively shown session?" The UI
  // Thinking/LiveActivity indicators use this. So that when the user clicks
  // another session and there is no real work in that session, it does not look
  // like "running".
  get runningHere(): boolean {
    // Fix 63c: when PAUSED return false INSTANTLY — when the user presses pause
    // the Thinking indicator disappears IMMEDIATELY. Does not wait for backend
    // confirmation. When the backend finishes the pause and returns paused=false
    // via pushStatus, applyStatus updates this.paused; then normal flow.
    if (this.paused) return false;
    return this.runningSessions.includes(this.activeSessionId);
  }

  // Fix 134: for the UI "Thinking"/LiveActivity indicator. runningHere (backend
  // authoritative) OR live stream activity (streamActive). Even if the backend
  // flag drops early, the indicator stays while content streams; on
  // terminal/silence streamActive closes. Does NOT BREAK runningHere semantics
  // (notification/rebuild gating still uses runningHere) — only the indicator reads this derived.
  get thinking(): boolean {
    if (this.paused) return false;
    return this.runningHere || this.streamActive;
  }

  private ws: WebSocket | null = null;
  private url = "";
  private gen = 0;
  private streamIdx = -1;
  // Fix STOP-3b: when the user presses stop/pause the in-flight commandId is
  // written here. After a backend interrupt, buffered sef_parcali/sef_cevap can
  // still arrive → delta/reply for commandIds in this set is IGNORED (the bubble
  // is not recreated). A new turn (sef_tur_basladi) removes the relevant
  // commandId from the guard.
  private stoppedCommandIds = new Set<string>();
  // The commandId of the currently streaming turn — set by sef_tur_basladi/
  // sef_parcali, cleared by sef_cevap/idle/tur_bitti. guardInFlightCommand()
  // adds this to stoppedCommandIds at stop/pause time.
  private inflightCmdId: string | null = null;
  private workerSeq = 0;
  private feedSeq = 0;
  private runTimer: ReturnType<typeof setInterval> | null = null;
  // Commands the user sent while WS was down — flushed on reconnect.
  private pendingOutgoing: string[] = [];
  // Fix 53: codegraph queries pending reqId -> resolver map. Resolved when the
  // WS reply arrives; rejected on a 15s timeout.
  private codegraphPending = new Map<string, { resolve: (sonuc: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private codegraphReqSeq = 0;

  codegraphQuery(op: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("No WS connection"));
        return;
      }
      const reqId = `cg-${++this.codegraphReqSeq}-${Date.now()}`;
      const timer = setTimeout(() => {
        if (this.codegraphPending.has(reqId)) {
          this.codegraphPending.delete(reqId);
          reject(new Error("CodeGraph timeout (15s)"));
        }
      }, 15_000);
      this.codegraphPending.set(reqId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ kind: "codegraph_iste", reqId, op, params }));
    });
  }

  // Fix 91 + Fix 103 watchdog state — collected the old lastSefActivity /
  // lastWatchdogIn / lastWatchdogOut fields into a single struct. Helpers are in
  // the ./watchdog.js module; the class delegates from here.
  private watchdog: WatchdogState = createWatchdog();
  // Distinguish watchdog-sourced runError from a real backend error. Only the
  // banner set by the watchdog should be cleared automatically when activity
  // returns; a real "hata" event must preserve the banner.
  private watchdogFired = false;

  // Fix 63: polling-based timer. Tied to the runningHere getter $states
  // (runningSessions + activeSessionId). UI render is already reactive — only a
  // tick is needed for the local elapsed counter. setInterval detects the
  // transition every second + inc/resets the counter.
  private prevRunningSnap = false;
  private startUniversalTimer(): void {
    if (this.runTimer) return;
    this.runTimer = setInterval(() => {
      // Tick every second for the workers elapsed indicator (HelperCard reads it).
      this.nowTick = Date.now();
      const cur = this.runningHere;
      // Fix 134: stream-activity decay — if no new streaming event arrives for 4s
      // close the indicator (a terminal event already closes it instantly; this is the backstop).
      if (this.streamActive && Date.now() - this.streamActiveTs > 4000) {
        this.streamActive = false;
      }
      // Transition NOT_RUNNING -> RUNNING: reset counters
      if (cur && !this.prevRunningSnap) {
        this.runElapsed = 0;
        this.runTokens = 0;
        this.liveIn = 0;
        this.liveOut = 0;
        this.liveCacheRead = 0;
        this.liveCacheCreate = 0;
        this.liveUncached = 0;
        this.liveUsd = 0;
        this.runError = null;
        // Fix 103: reset the watchdog snapshot at the start of a new turn.
        resetWatchdog(this.watchdog);
      }
      // Transition RUNNING -> NOT_RUNNING: clear backgroundBusy
      if (!cur && this.prevRunningSnap) {
        this.backgroundBusy = false;
      }
      if (cur) {
        this.runElapsed += 1;
        // Fix 91: a nested tool may be running (talk_to_chief 10min).
        // If there is a "calisiyor" status within canliAktivite the watchdog is silenced.
        const toolStillRunning = this.canliAktivite.some(
          (a) => a.durum === "calisiyor",
        );
        const timeoutMsg = !this.restarting
          ? watchdogTimeoutMessage(this.watchdog, toolStillRunning)
          : null;
        if (timeoutMsg) {
          this.runError = timeoutMsg;
          this.watchdogFired = true;
        } else if (this.watchdogFired) {
          // Activity came back (idle < timeout or a tool is running) — clear the
          // watchdog-sourced lingering banner. A real "hata" banner is preserved
          // because watchdogFired=false.
          this.runError = null;
          this.watchdogFired = false;
        }
      }
      this.prevRunningSnap = cur;
    }, 1000);
  }

  private stopUniversalTimer(): void {
    if (this.runTimer) {
      clearInterval(this.runTimer);
      this.runTimer = null;
    }
  }

  // Fix 63: backward-compat no-op (keep old code call sites).
  private stopRun(): void { /* no-op — universal timer handles */ }
  private startRun(): void { /* no-op — runningHere getter handles */ }

  connect(port: number): void {
    // Fix 63: start the universal timer — it tracks runningHere snapshot
    // transitions and inc/resets the local elapsed counter.
    this.startUniversalTimer();
    const url = `ws://127.0.0.1:${port}`;
    if (url !== this.url) {
      this.agents = [];
      this.feed = [];
      this.workers = [];
      this.chat = [];
      this.canliAktivite = [];
      this.diffs = [];
      this.queue = [];
      this.tokensIn = 0;
      this.tokensOut = 0;
      this.contextTokens = 0;
      this.paused = false;
      this.pendingOutgoing = [];
      this.stopRun();
    }
    this.url = url;
    // Fix 101: when the window is closed pendingOutgoing is lost in-memory.
    // After reopen the message may not have reached the backend (TCP race before
    // close). Persist to localStorage + restore in connect(). After reopen the
    // onopen handler flushes pendingOutgoing to WS — messages are not lost.
    const stored = loadPending(this.url);
    if (stored.length) {
      this.pendingOutgoing = [...this.pendingOutgoing, ...stored];
    }
    this.gen++;
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.open();
  }

  private open(): void {
    const myGen = this.gen;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      if (myGen !== this.gen) return;
      this.connected = true;
      // Restart grace period — the new process came up, clear runError and close
      // the restarting overlay. (The 60s timer remains as a last resort.)
      if (this.restarting) {
        this.restarting = false;
        this.runError = null;
      }
      // Request a fresh snapshot after reconnect — the old "isleniyor" queue has
      // already turned to "kesildi" on the backend side (queue.recover).
      // applyStatus will call stopRun with the new state.
      try {
        this.ws?.send(JSON.stringify({ kind: "durum_iste" }));
      } catch {
        /* ignore */
      }
      if (this.pendingOutgoing.length && this.ws?.readyState === WebSocket.OPEN) {
        for (const raw of this.pendingOutgoing) this.ws.send(raw);
        this.pendingOutgoing = [];
        // Fix 101: after flush also clear from localStorage.
        savePending(this.url, this.pendingOutgoing);
      }
    };
    ws.onclose = () => {
      if (myGen !== this.gen) return;
      this.connected = false;
      setTimeout(() => {
        if (myGen === this.gen) this.open();
      }, 2000);
    };
    ws.onmessage = (e) => {
      if (myGen !== this.gen) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data) as ServerMessage;
      } catch {
        return;
      }
      this.handle(msg);
    };
  }

  sendCommand(text: string, ekler: Attachment[] = []): void {
    // Block sending entirely while disconnected — the UI Composer is already
    // locked via disabled, but this is a guardrail against programmatic callers.
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) return;
    const dosyalar = ekler.filter((e) => e.tur === "dosya");
    const resimler = ekler.filter((e) => e.tur === "resim");
    const etiket = dosyalar.length
      ? `${text}${text ? "\n" : ""}📎 ${dosyalar.map((e) => e.ad).join(", ")}`
      : text;
    const images = resimler.map(
      (r) => `data:${r.mediaType ?? "image/png"};base64,${r.veri}`,
    );
    // If sent while the agent is running this message goes to the queue — the UI
    // should show a green background + "Queued" badge.
    const queuedNow = this.running;
    // /clear bug fix: if the user typed /clear, clear the history chat in the UI
    // IMMEDIATELY. The backend also resets chat + sends pushStatus, but the UI
    // reconcile was not wiping a non-empty local chat with an empty status.chat.
    // A local preempt gives an observable, lag-free clear.
    if (text.trim() === "/clear") {
      this.chat = [];
    }
    this.chat.push({
      role: "kullanici",
      text: etiket,
      ts: Date.now(),
      images: images.length ? images : undefined,
      queued: queuedNow ? true : undefined,
    });
    // Detach the old turn's streamIdx and canliAktivite IMMEDIATELY — so the
    // old turn's tools do not mix on screen with the user's new message. Until a
    // new sef_tur_basladi arrives the live area shows empty; the user message
    // appears as queued.
    this.streamIdx = -1;
    this.canliAktivite = [];
    // Fix 120: stamp the command with the session id active at the moment it is
    // SENT. The backend uses this immutable sessionId instead of mutable
    // getActiveId(); so even if the session changes between turns the message
    // lands in the right queue bucket — it does not fall into a wrong/__noid__
    // bucket and spawn a second parallel runner. (The control message also
    // carries sessionId — same pattern.)
    const raw = JSON.stringify({
      kind: "komut",
      text,
      ekler,
      sessionId: this.activeSessionId,
    });
    // try/catch the send — on partial frame/buffer full errors put it in pending.
    // It is sent automatically on reconnect. Frame safety is critical because
    // image base64 can be large.
    let sent = false;
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(raw);
        sent = true;
      } catch {
        /* send fail — put in pending */
      }
    }
    if (!sent) {
      if (this.pendingOutgoing.length < 50) this.pendingOutgoing.push(raw);
      // Fix 101: back up the pending message to localStorage — so it survives window close.
      savePending(this.url, this.pendingOutgoing);
    }
    this.startRun();
  }

  setAgentModel(agent: string, model: string, effort: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ kind: "uzman_model", agent, model, effort }));
    }
  }

  // F1.2 (Option B): sendToAgent removed. The UI does not communicate with the
  // expert directly; the chief spawns it via the Agent tool, and the user writes to the chief.

  // Multi-session WS commands.
  sessionCreate(ad?: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    // The active session will change — empty the UI chat, it fills when the backend sends a new snapshot.
    this.chat = [];
    this.streamIdx = -1;
    this.canliAktivite = [];
    this.ws.send(JSON.stringify({ kind: "session_olustur", sessionAd: ad }));
  }

  sessionSelect(sessionId: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (sessionId === this.activeSessionId) return;
    // Race + multi-session display fix:
    // 1) the pendingSessionSwitch flag makes applyStatus skip the chat reconcile
    //    until the target ID is reached (so the old session's chat does not come back).
    // 2) clear running/paused/canliAktivite LOCALLY — if the Chief Architect is
    //    running in another session, do not show a wrong "agent running" indicator.
    //    Backend pause is no longer global (main.ts onControl guard).
    this.pendingSessionSwitch = sessionId;
    // Fix 60c CRITICAL: update local activeSessionId IMMEDIATELY. Waiting for the
    // backend reply caused runningHere to bind to the wrong session:
    // - send a message in test2 → optimistic={test2,now}, runningSessions=[test2]
    // - click rate-test → because activeSessionId waits for the BACKEND it stays
    //   test2 → runningHere: runningSessions.includes(test2)=true → Thinking
    //   appears on the wrong session.
    // If local is current: activeSessionId=rate-test, includes(rate-test)=false
    // → Thinking is not shown.
    this.activeSessionId = sessionId;
    this.chat = [];
    this.streamIdx = -1;
    this.canliAktivite = [];
    if (this.running || this.runTimer) this.stopRun();
    this.paused = false;
    this.ws.send(JSON.stringify({ kind: "session_sec", sessionId }));
  }

  sessionDelete(sessionId: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ kind: "session_sil", sessionId }));
  }

  sessionRename(sessionId: string, ad: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ kind: "session_yeniden_adlandir", sessionId, sessionAd: ad }));
  }

  dispose(): void {
    this.gen++;
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    // Fix 63: stop the universal timer.
    this.stopUniversalTimer();
  }

  setChiefModel(model: string, effort: string, fast: boolean = this.chiefFast): void {
    this.chiefModel = model;
    this.chiefEffort = effort;
    this.chiefFast = fast;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ kind: "sef_model", model, effort, fast }));
    }
  }

  control(aksiyon: ControlAction): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Fix STOP-1: inform the backend of the active session — the backend targets
    // that session's real query (the UI active tab != the running session, possibly).
    this.ws.send(
      JSON.stringify({ kind: "kontrol", aksiyon, sessionId: this.activeSessionId }),
    );
    if (aksiyon === "duraklat") {
      // Fix STOP-3b: put the in-flight commandId in the guard — so buffered
      // delta/reply arriving after the interrupt does not recreate this bubble.
      this.guardInFlightCommand();
      this.paused = true;
      // INSTANT UI stop — does not wait for a backend roundtrip. If there is a
      // real active query on the back side, its sef_cevap still arrives and is a
      // no-op. A fast escape for the user in a Stuck-Thinking situation.
      // Freeze the token counters (so the last real value stays visible) — the
      // sef_token guard already does not update while paused.
      this.stopRun();
      this.canliAktivite = [];
      this.streamIdx = -1;
    } else if (aksiyon === "durdur") {
      // F7: durdur = cut only the current turn; the queue is not paused, the next
      // waiting message is taken into processing immediately by the backend. The
      // UI optimistically clears live activity but does NOT set paused=true — so
      // the composer "Send" button stays open and the user can add a new message right away.
      // Fix STOP-3b: put the in-flight commandId in the guard.
      this.guardInFlightCommand();
      this.stopRun();
      this.canliAktivite = [];
      this.streamIdx = -1;
    } else if (aksiyon === "devam") this.paused = false;
    else if (aksiyon === "plan_ac") this.planMode = true;
    else if (aksiyon === "plan_kapat") this.planMode = false;
  }

  // Fix STOP-3b: at stop/pause time, put the streaming turn's commandId in the
  // guard. After a backend interrupt buffered sef_parcali/sef_cevap can still
  // arrive; this set is checked at the start of handle() → delta/reply for a
  // guarded commandId is IGNORED (the bubble is not redrawn, the "write from above" bug ends).
  private guardInFlightCommand(): void {
    let cid = this.inflightCmdId;
    if (!cid && this.streamIdx >= 0) cid = this.chat[this.streamIdx]?.commandId ?? null;
    if (cid) this.stoppedCommandIds.add(cid);
  }

  // F3 (autonomous 3-day mode): JobMonitor right panel button actions.
  // The backend WS handler triggers onAutonomousAction; the result arrives via
  // status push and autonomousJobs is updated.
  pauseAutonomousJob(jobId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ kind: "otonom_pause", jobId }));
  }
  resumeAutonomousJob(jobId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ kind: "otonom_resume", jobId }));
  }
  cancelAutonomousJob(jobId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ kind: "otonom_cancel", jobId }));
  }

  // F4 (Cost Control): update the role-based daily USD cap. The backend calls
  // budgetManager.updateConfig + the UI refreshes live via pushStatus.
  setBudgetCap(
    role: "chief" | "mimar" | "specialist" | "advisor" | "worker",
    capUsd: number,
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!Number.isFinite(capUsd) || capUsd < 0) return;
    this.ws.send(JSON.stringify({ kind: "butce_cap", role, capUsd }));
  }

  dismissRollback(): void {
    if (this.autoRollback) {
      this.rollbackDismissedTs = this.autoRollback.ts;
    }
  }

  cevaplaSoru(cevap: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.ajanSoru) return;
    const askId = this.ajanSoru.askId;
    this.ws.send(
      JSON.stringify({
        kind: "kullanici_cevap",
        askId,
        cevap,
      }),
    );
    // Mark the question message in chat with answered+secim (it grays out, the
    // buttons disable, and which choice was made becomes visible).
    for (const m of this.chat) {
      if (m.role === "agent_question" && m.askId === askId && !m.answered) {
        m.answered = true;
        m.secim = cevap;
        break;
      }
    }
    // Echo: drop the user choice message into chat — so it is clear what the
    // agent will do, no "silently continue".
    this.chat.push({
      role: "user_choice",
      text: cevap,
      ts: Date.now(),
      askId,
    });
    this.chat = [...this.chat];
    this.ajanSoru = null;
  }

  private handle(msg: ServerMessage): void {
    // P1.33: sessions that do not own the sef_* events are SKIPPED in the UI.
    // The backend already persisted to chatLog (pushChatFor); when the user
    // switches to that session it loads via durum.chat. In the old behavior, when
    // commandId was not found in the active session a new entry was pushed and
    // landed in the WRONG SESSION, so another session's reply appeared below the
    // last sent message.
    // Fix 60 CRITICAL: CLEANUP EVENTS ARE NOT FILTERED. sef_idle, sef_tur_bitti,
    // sef_tamamen_idle are signals that clear global state. The moment the user
    // switches to another session via session_sec, if the old session's cleanup
    // signals were dropped in the EVENT_KINDS filter the `running` flag stayed
    // stale TRUE → Thinking stuck (Bug 1 & 2). The filter is applied only to
    // DISPLAY events (parcali/cevap/aktivite/token) because they affect the UI visually.
    // Fix (thinking flicker): sef_aktivite_io + sef_aktivite_token ADDED. When the
    // old list skipped these, a parallel/secondary session's token event passed
    // the gate and lit up a finished turn's "Thinking" every 5-6s + caused a wrong
    // watchdog bump. Now these events also early-return on a mismatched session.
    const sefDisplayKinds = new Set([
      "sef_cevap", "sef_parcali", "sef_aktivite", "sef_token",
      "sef_aktivite_io", "sef_aktivite_token",
      "sef_tur_basladi",
    ]);
    if (sefDisplayKinds.has(msg.kind)) {
      const evSid = (msg as { sessionId?: string }).sessionId;
      if (evSid && evSid !== this.activeSessionId) {
        return;
      }
    }
    // Fix STOP-3b: for a commandId guarded by stop/pause, IGNORE it even if the
    // backend sends buffered sef_parcali/sef_cevap — so the bubble is not redrawn
    // ("write from above after stop"). If sef_cevap, clear the streaming flags and
    // exit (the turn is considered cut).
    if (
      (msg.kind === "sef_parcali" || msg.kind === "sef_cevap") &&
      msg.commandId &&
      this.stoppedCommandIds.has(msg.commandId)
    ) {
      if (msg.kind === "sef_cevap") {
        this.streamIdx = -1;
        this.canliAktivite = [];
        this.stopRun();
      }
      return;
    }
    // Track the streaming turn's commandId — guardInFlightCommand() uses this.
    if (msg.kind === "sef_tur_basladi" && msg.commandId) {
      this.inflightCmdId = msg.commandId;
      // New turn: the same commandId may have stayed in the guard, clear it.
      this.stoppedCommandIds.delete(msg.commandId);
    } else if (msg.kind === "sef_parcali" && msg.commandId) {
      this.inflightCmdId = msg.commandId;
    } else if (
      (msg.kind === "sef_cevap" || msg.kind === "sef_idle" || msg.kind === "sef_tur_bitti") &&
      msg.commandId === this.inflightCmdId
    ) {
      this.inflightCmdId = null;
    }

    // Update the activity timestamp on chief-related "REAL" activity events. For
    // parcali only a non-empty delta, watchdog reset.
    // Fix 103: sef_token also counts as progress IF liveIn is increasing.
    // During Anthropic thinking mode (reasoning) no tool/partial event arrives
    // but the backend emits sef_token periodically; if the liveIn value grows the
    // process is really thinking — so the watchdog does not give a 180s false-positive.
    let watchdogBumped = false;
    if (
      msg.kind === "sef_cevap" ||
      msg.kind === "sef_aktivite" ||
      msg.kind === "sef_aktivite_io" ||
      msg.kind === "sef_aktivite_token" ||
      msg.kind === "sef_tur_basladi"
    ) {
      bumpWatchdogActivity(this.watchdog);
      watchdogBumped = true;
    } else if (msg.kind === "sef_parcali" && msg.delta && msg.delta.length > 0) {
      bumpWatchdogActivity(this.watchdog);
      watchdogBumped = true;
    } else if (msg.kind === "sef_token") {
      const curIn = (msg as { liveIn?: number }).liveIn ?? 0;
      const curOut = (msg as { liveOut?: number }).liveOut ?? 0;
      bumpWatchdogIfTokensGrew(this.watchdog, curIn, curOut);
      watchdogBumped = true;
    }
    // Real activity arrived — clear the watchdog lingering banner instantly
    // without waiting for the timer (the backend was continuing while the UI showed "Response timeout").
    if (watchdogBumped && this.watchdogFired) {
      this.runError = null;
      this.watchdogFired = false;
    }
    // Fix 134: live stream activity → open the indicator. Close it on terminal
    // events (cevap/idle/tur_bitti/tamamen_idle). If new parcali/aktivite arrives
    // in the SAME block after sef_cevap (bug scenario) it reopens — the indicator
    // follows the real flow. sef_token is NOT included (a zombie token can give a
    // false-positive; in pure thinking runningHere is already true).
    // Fix (thinking flicker): streamActive opens ONLY with an event of the
    // active/shown session. If a parallel (3 projects) or secondary session
    // streams sef_aktivite_token over the same WS, a FINISHED turn's "Thinking"
    // misfired every 5-6s. sef_* messages carry sessionId (server.ts:421-459);
    // if they do not match the indicator is not triggered. If there is no sessionId (legacy) allow it.
    const evSid = (msg as { sessionId?: string }).sessionId;
    const evSidMatches = !evSid || evSid === this.activeSessionId;
    if (
      evSidMatches &&
      (msg.kind === "sef_aktivite" ||
        msg.kind === "sef_aktivite_io" ||
        msg.kind === "sef_aktivite_token" ||
        msg.kind === "sef_tur_basladi" ||
        (msg.kind === "sef_parcali" && !!msg.delta && msg.delta.length > 0))
    ) {
      this.streamActiveTs = Date.now();
      this.streamActive = true;
    } else if (
      msg.kind === "sef_cevap" ||
      msg.kind === "sef_idle" ||
      msg.kind === "sef_tur_bitti" ||
      msg.kind === "sef_tamamen_idle"
    ) {
      // Terminal event: only the active session's should close the indicator —
      // another session's reply must not extinguish ours.
      if (evSidMatches) {
        this.streamActive = false;
        this.streamActiveTs = 0;
      }
    }
    if (msg.kind === "durum") {
      this.applyStatus(msg.payload);
    } else if (msg.kind === "codegraph_yanit") {
      // Fix 53: CodeGraph WS reply — resolves the pending promise.
      const cgMsg = msg as { kind: "codegraph_yanit"; reqId: string; ok: boolean; sonuc?: unknown; hata?: string };
      const pending = this.codegraphPending.get(cgMsg.reqId);
      if (pending) {
        this.codegraphPending.delete(cgMsg.reqId);
        if (cgMsg.ok) pending.resolve(cgMsg.sonuc);
        else pending.reject(new Error(cgMsg.hata ?? "codegraph_hata"));
      }
    } else if (msg.kind === "sef_parcali") {
      // P1.30: bind the entry by commandId. When multiple queued turns streamed
      // back-to-back there was a streamIdx race (the old turn's reply overwrote
      // the new turn's empty entry); with commandId each turn finds its own entry.
      // Fix 64c: commandId match ONLY on role="sef" entries. Fix 64b wrote
      // commandId to the backend user msg (for queue tracking) — without a role
      // filter here the UI was overwriting the user message with the chief's reply.
      const cid = msg.commandId;
      // SKIP SEALED: streaming that continues after a mid-turn question must
      // target a new bubble, NOT the (sealed) bubble from BEFORE the question.
      if (msg.reset) {
        this.canliAktivite = [];
        // If there is an UNSEALED entry for the same commandId use it, otherwise create a new one.
        let idx = cid ? this.chat.findIndex((m) => m.commandId === cid && m.role === "sef" && !m.sealed) : -1;
        if (idx >= 0) {
          this.chat[idx].text = "";
          this.chat[idx].segments = [];
        } else {
          this.chat.push({ role: "sef", text: "", ts: Date.now(), segments: [], commandId: cid });
          idx = this.chat.length - 1;
        }
        this.streamIdx = idx;
        this.chat = [...this.chat];
      } else {
        // delta append — find the UNSEALED entry by commandId (Fix 64c: role=sef filter).
        let idx = cid ? this.chat.findIndex((m) => m.commandId === cid && m.role === "sef" && !m.sealed) : this.streamIdx;
        if (idx < 0 && this.streamIdx >= 0 && this.chat[this.streamIdx]) idx = this.streamIdx;
        // No unsealed bubble (first delta after a mid-turn question) → open a new
        // bubble. It forms BELOW the question/choice card, so the chat flows correctly.
        if (idx < 0) {
          this.chat.push({ role: "sef", text: "", ts: Date.now(), segments: [], commandId: cid });
          idx = this.chat.length - 1;
          this.streamIdx = idx;
        }
        if (idx >= 0 && this.chat[idx]) {
          const m = this.chat[idx];
          if (cid && !m.commandId) m.commandId = cid;
          m.text += msg.delta;
          if (!m.segments) m.segments = [];
          const last = m.segments[m.segments.length - 1];
          if (last && last.kind === "text") last.text += msg.delta;
          else m.segments.push({ kind: "text", text: msg.delta });
          this.chat = [...this.chat];
        }
      }
    } else if (msg.kind === "sef_cevap") {
      // P1.30: find the entry by commandId (not streamIdx — queued turns were
      // overwriting the same streamIdx).
      // Fix 64c: role=sef filter — do not mix with the user msg.
      const cid = msg.commandId;
      // Target the UNSEALED entry — the final reply after a mid-turn question is
      // written to the continuation bubble (below the question), NOT the sealed
      // bubble from before the question.
      let idx = cid ? this.chat.findIndex((m) => m.commandId === cid && m.role === "sef" && !m.sealed) : -1;
      if (idx < 0 && this.streamIdx >= 0 && this.chat[this.streamIdx]) {
        // Backward compat: streamIdx fallback if there is no commandId.
        idx = this.streamIdx;
      }
      // Was there a mid-turn question? If so msg.text contains the WHOLE turn text
      // (before + after the question); the before-question part is already in the
      // sealed bubble. Writing the full text into the continuation bubble would
      // duplicate → SKIP the text/segment overwrite, the streamed deltas already
      // hold the correct after-question content.
      const hasSealedSibling =
        !!cid && this.chat.some((m) => m.commandId === cid && m.role === "sef" && m.sealed);
      if (idx >= 0 && this.chat[idx]) {
        const m = this.chat[idx];
        if (cid && !m.commandId) m.commandId = cid;
        // PROTECTIVE OVERWRITE: text/segments accumulated during streaming may in
        // some cases be richer than the final reply (thinking blocks, tool
        // outputs). If the final is shorter keep the old state — to avoid content
        // loss. Overwrite if the final is longer or streaming was empty. (If there
        // is a sealed sibling there is NO overwrite — see above.)
        if (!hasSealedSibling && (!m.text || (msg.text && msg.text.length >= m.text.length * 0.9))) {
          m.text = msg.text;
        }
        m.aktivite = msg.aktivite;
        m.cost = msg.cost;
        m.ts = Date.now(); // reply completion moment — the end, not the start
        // Segments: take the final if it contains more segments, otherwise keep
        // what was accumulated during streaming. (If there is a sealed sibling keep streamed.)
        if (
          !hasSealedSibling &&
          msg.segments &&
          msg.segments.length &&
          (!m.segments || msg.segments.length >= m.segments.length)
        ) {
          // Carry over the live subagent activity trail (ilerleme) + durum by tool id.
          // The backend final segments rebuild tool objects WITHOUT these UI-only
          // fields, so without this the expandable Activity panel would go blank the
          // moment the turn finishes. Preserve them so the trail stays after the turn.
          const carry = new Map<string, { ilerleme?: string; durum?: string }>();
          for (const seg of m.segments ?? []) {
            if (seg.kind !== "tools") continue;
            for (const t of seg.tools as Array<ToolActivity & { ilerleme?: string; durum?: string }>) {
              if (t.id && (t.ilerleme || t.durum)) carry.set(t.id, { ilerleme: t.ilerleme, durum: t.durum });
            }
          }
          m.segments = msg.segments;
          if (carry.size) {
            for (const seg of m.segments) {
              if (seg.kind !== "tools") continue;
              for (const t of seg.tools as Array<ToolActivity & { ilerleme?: string; durum?: string }>) {
                const c = t.id ? carry.get(t.id) : undefined;
                if (c) {
                  if (c.ilerleme && !t.ilerleme) t.ilerleme = c.ilerleme;
                  if (c.durum && !t.durum) t.durum = c.durum;
                }
              }
            }
          }
        }
        if (msg.images && msg.images.length) m.images = msg.images;
        if (msg.narrative) m.narrative = msg.narrative;
        if (msg.autonomousFail) m.autonomousFail = true;
        this.chat = [...this.chat];
      } else {
        this.chat.push({
          role: "sef",
          text: msg.text,
          ts: Date.now(),
          aktivite: msg.aktivite,
          segments: msg.segments,
          cost: msg.cost,
          images: msg.images,
          narrative: msg.narrative,
          autonomousFail: msg.autonomousFail,
          commandId: cid,
        });
      }
      this.streamIdx = -1;
      this.canliAktivite = [];
      // Fix 63: the lifecycle effect is tied to runningHere; no setTimeout
      // fallback needed. When the backend pushStatus sends runningSessions=[] the
      // effect calls killRunTimer.
    } else if (msg.kind === "sef_aktivite_io") {
      // Fix 93: tool input/result mid-stream — update the tool input/result
      // fields in canliAktivite + chat segments. So that when a tool opens the UI
      // instantly shows what it read/wrote.
      const v = this.canliAktivite.find((a) => a.id === msg.id);
      if (v) {
        // Fix 128: "ilerleme" — subagent live progress text (Agent card).
        if (msg.ioKind === "ilerleme") v.ilerleme = msg.text;
        else if (msg.ioKind === "girdi") v.girdi = msg.text;
        else { v.sonuc = msg.text; v.hata = !!msg.hata; }
        this.canliAktivite = [...this.canliAktivite];
      }
      let touched = false;
      for (const m of this.chat) {
        if (!m.segments) continue;
        for (const seg of m.segments) {
          if (seg.kind !== "tools") continue;
          for (const t of seg.tools) {
            if (t.id === msg.id) {
              if (msg.ioKind === "ilerleme") t.ilerleme = msg.text;
              else if (msg.ioKind === "girdi") t.girdi = msg.text;
              else { t.sonuc = msg.text; t.hata = !!msg.hata; }
              touched = true;
              break;
            }
          }
          if (touched) break;
        }
        if (touched) break;
      }
      if (touched) this.chat = [...this.chat];
    } else if (msg.kind === "sef_aktivite_token") {
      // Fix 62: per-tool token update — update tools[].tokens in canliAktivite +
      // chat segments. So the mid-stream badge appears.
      const v = this.canliAktivite.find((a) => a.id === msg.id);
      if (v) {
        v.tokens = msg.tokens;
        this.canliAktivite = [...this.canliAktivite];
      }
      // Scan chat segments — id-based match (Fix 62 added tool.id).
      let touched = false;
      for (const m of this.chat) {
        if (!m.segments) continue;
        for (const seg of m.segments) {
          if (seg.kind !== "tools") continue;
          for (const t of seg.tools) {
            if (t.id === msg.id) {
              t.tokens = msg.tokens;
              touched = true;
              break;
            }
          }
          if (touched) break;
        }
        if (touched) break;
      }
      if (touched) this.chat = [...this.chat];
    } else if (msg.kind === "sef_aktivite") {
      const v = this.canliAktivite.find((a) => a.id === msg.id);
      if (v) {
        v.durum = msg.durum;
      } else {
        this.canliAktivite.push({ id: msg.id, ad: msg.ad, durum: msg.durum });
      }
      this.canliAktivite = [...this.canliAktivite];
      // Reflect into the streaming message's segments too — so the tool batch is
      // seen in the correct order between text blocks, AND the finished/error state
      // propagates to the inline card. Previously ONLY "calisiyor" was reflected; a
      // finished Agent whose result text was empty had no `sonuc` to flip it, so the
      // SubagentInline card stayed stuck on "running" until the whole turn ended.
      // Now "bitti"/"hata" write durum onto the existing segment tool so the card
      // flips immediately (SubagentInline reads tool.durum).
      if (this.streamIdx >= 0 && this.chat[this.streamIdx]) {
        const m = this.chat[this.streamIdx];
        if (!m.segments) m.segments = [];
        let existing: (ToolActivity & { durum?: string }) | undefined;
        for (const seg of m.segments) {
          if (seg.kind !== "tools") continue;
          const f = seg.tools.find((t) => t.id === msg.id);
          if (f) { existing = f as ToolActivity & { durum?: string }; break; }
        }
        if (existing) {
          existing.durum = msg.durum;
        } else if (msg.durum === "calisiyor") {
          const last = m.segments[m.segments.length - 1];
          // Fix 62: add id to the tool object — for mid-stream token update match.
          const tool = { id: msg.id, ad: msg.ad, girdi: "", sonuc: "", hata: false, durum: msg.durum } as ToolActivity & { durum?: string };
          if (last && last.kind === "tools") last.tools.push(tool);
          else m.segments.push({ kind: "tools", tools: [tool] });
        }
        this.chat = [...this.chat];
      }
    } else if (msg.kind === "sef_tur_basladi") {
      // The backend took a new command into processing — start the UI indicator
      // instantly. If there are multiple commands queued, avoid "Thinking" flicker.
      // A new turn is starting: CLEAR the OLD turn's canliAktivite; otherwise the
      // old tools stay on the new turn's screen.
      this.canliAktivite = [];
      this.currentTurnAuto = !!msg.autonomous;
      this.backgroundBusy = !!msg.autonomous;
      // A new turn started — the first queued user message is now being
      // processed; remove the "Queued" badge.
      if (!msg.autonomous) {
        const ilkQ = this.chat.find((m) => m.role === "kullanici" && m.queued);
        if (ilkQ) {
          ilkQ.queued = undefined;
          this.chat = [...this.chat];
        }
      }
      // Even if a spurious sef_tur_basladi arrives during pause (queue race) do
      // not startRun — the user must see that they paused.
      if (!this.paused) {
        // New turn — reset the live token/cost/elapsed values INSTANTLY.
        // CRITICAL: the runTimer transition (NOT_RUNNING->RUNNING) reset can be
        // delayed up to 1000ms; in that window the PREVIOUS turn's in/out/$/cache
        // numbers appear next to "Thinking" and then drop to 0 ("carries over then
        // corrects" bug). Resetting at event time makes every new turn start from 0.
        // Valid both for a new turn from idle AND a consecutive turn from the queue.
        this.runTokens = 0;
        this.liveIn = 0;
        this.liveOut = 0;
        this.liveCacheRead = 0;
        this.liveCacheCreate = 0;
        this.liveUncached = 0;
        this.liveUsd = 0;
        this.runElapsed = 0;
        if (!this.running) this.startRun();
      }
    } else if (msg.kind === "sef_idle") {
      // Backend "I AM IDLE" signal — clear the UI.
      this.streamIdx = -1;
      this.canliAktivite = [];
      // Fix 63: the lifecycle effect is tied to runningHere.
    } else if (msg.kind === "sef_tur_bitti") {
      // A single turn finished — stop the UI Thinking indicator, show the
      // planYarim badge if needed. Does NOT fire a notification.
      // FIX: turn finished = ajanSoru is now invalid (answered or cancelled).
      // Otherwise the "Agent question waiting" banner stays stuck forever.
      this.planYarim = !!msg.planYarim;
      this.streamIdx = -1;
      this.canliAktivite = [];
      this.ajanSoru = null;
      // M10: runError set during a transient retry may still show "Temporary API
      // error..." when the turn completes successfully. Turn finished = the retry
      // message is stale. The next real error sets it again.
      this.runError = null;
      // Fix 63: stopRun no-op; the lifecycle effect is tied to runningHere.
    } else if (msg.kind === "sef_tamamen_idle") {
      // Real "work done" — notification fires ONLY here.
      // The +page.svelte effect is triggered by the tamamenIdleSignal increment.
      this.tamamenIdleSignal++;
      this.streamIdx = -1;
      this.canliAktivite = [];
      this.ajanSoru = null;
      this.runError = null;
      // Fix 63: stopRun no-op; runningSessions is cleared via pushStatus.
    } else if (msg.kind === "sef_token") {
      // The backend should already swallow during pause (orchestrator/main.ts
      // pause guard); extra protection on the UI side: do NOT update tokens while
      // paused — so the last real value stays visible.
      if (this.paused) return;
      // Live in/out during a run (fresh billed input + output) — 0 at command start.
      if (this.running) {
        this.liveIn = msg.liveIn;
        this.liveOut = msg.liveOut;
        this.runTokens = msg.liveIn + msg.liveOut;
        // Cache-aware breakdown — PROMPT 10.
        if (typeof msg.liveCacheRead === "number") this.liveCacheRead = msg.liveCacheRead;
        if (typeof msg.liveCacheCreate1h === "number") this.liveCacheCreate = msg.liveCacheCreate1h;
        if (typeof msg.liveUncached === "number") this.liveUncached = msg.liveUncached;
        if (typeof msg.liveUsd === "number") this.liveUsd = msg.liveUsd;
        if (typeof msg.model === "string") this.liveModel = msg.model;
      }
      // sessionUsd accumulation — update even on pause/idle (the backend already
      // does not emit events while paused; this line does not depend on running).
      if (typeof msg.sessionUsd === "number") this.sessionUsd = msg.sessionUsd;
      // Context fill - persistent over the session, not dependent on the running state.
      this.contextTokens = msg.context;
    } else if (msg.kind === "ajan_soru") {
      this.ajanSoru = {
        askId: msg.askId,
        soru: msg.soru,
        secenekler: msg.secenekler,
        cokluSecim: msg.cokluSecim,
        serbestMetin: msg.serbestMetin,
      };
      // Mid-turn question: SEAL the active chief bubble accumulated so far +
      // reset streamIdx. Streaming continuing after the answer opens a new bubble
      // (below the question/choice card) — it is not written over the old bubble,
      // the chat flows below the question.
      if (this.streamIdx >= 0 && this.chat[this.streamIdx]) {
        this.chat[this.streamIdx].sealed = true;
      }
      this.streamIdx = -1;
      this.canliAktivite = [];
      // Drop the inline question card into chat — no popup, below the last
      // message. FIX: repeat events with the same askId must not produce a
      // duplicate card (on WS reconnect the backend rebroadcasts ajan_soru).
      const exists = this.chat.some(
        (m) => m.role === "agent_question" && m.askId === msg.askId,
      );
      if (!exists) {
        this.chat.push({
          role: "agent_question",
          text: msg.soru,
          ts: Date.now(),
          askId: msg.askId,
          secenekler: msg.secenekler,
          cokluSecim: msg.cokluSecim,
          serbestMetin: msg.serbestMetin,
          answered: false,
        });
        this.chat = [...this.chat];
      }
      // OS notification if the window is not focused — so the user notices.
      const focused =
        typeof document !== "undefined" &&
        document.visibilityState === "visible" &&
        document.hasFocus();
      if (!focused) {
        void notifyAgentQuestion({
          agentName: this.agentDisplayName,
          question: msg.soru,
        });
      }
    } else if (msg.kind === "event") {
      this.applyEvent(msg.event);
    }
  }

  private applyStatus(status: ProjectStatus): void {
    if (status.agents) {
      const prev = new Map(this.agents.map((a) => [a.name, a]));
      this.agents = status.agents.map((a) => {
        const old = prev.get(a.name);
        return {
          ...a,
          status: old?.status ?? "bos",
          task: old?.task ?? null,
          assignedBy: old?.assignedBy ?? null,
          transcript: old?.transcript ?? "",
        };
      });
    }
    if (status.queue) this.queue = status.queue;
    if (status.chief) {
      this.chiefModel = status.chief.model;
      this.chiefEffort = status.chief.effort;
      if (typeof status.chief.fast === "boolean") this.chiefFast = status.chief.fast;
    }
    if (status.chat && this.chat.length === 0) {
      this.chat = status.chat;
    }
    if (typeof status.context === "number") {
      this.contextTokens = status.context;
    }
    if (typeof status.paused === "boolean") {
      this.paused = status.paused;
    }
    if (status.autoRollback && status.autoRollback.ts) {
      this.autoRollback = status.autoRollback;
    } else if (status.autoRollback === null) {
      this.autoRollback = null;
    }
    // F3 (autonomous 3-day mode): hydrate the job list. The backend sends it on
    // every status push; null/missing -> keep the current list (to prevent UI flicker).
    if (Array.isArray(status.autonomousJobs)) {
      this.autonomousJobs = status.autonomousJobs;
    }
    // F4: budget report — if null/missing keep the current value (prevent flicker).
    if (status.budgets) {
      this.budgets = status.budgets;
    }
    if (status.cost) {
      if (typeof status.cost.sessionUsd === "number") {
        this.sessionUsd = status.cost.sessionUsd;
      }
      if (typeof status.cost.hourlyUsd === "number") {
        this.hourlyUsd = status.cost.hourlyUsd;
      }
    }
    if (status.sessions) this.sessions = status.sessions;
    // P1.28: the backend says which session is running a chief query.
    // null = no query. The UI shows the "Thinking" indicator only if this session
    // is active.
    if (status.activeQuerySessionId !== undefined) {
      this.activeQuerySessionId = status.activeQuerySessionId;
    }
    // P1.33: parallel running session list.
    if (Array.isArray(status.runningSessions)) {
      this.runningSessions = status.runningSessions;
      // Fix 60b CRITICAL: the old logic cleared optimistic ONLY if
      // runningSessions.includes(sid). On a fast turn (~800ms) the UI gets no
      // intermediate pushStatus — when the final pushStatus arrives with
      // runningSessions=[], includes(sid) is false → optimistic STAYS → Thinking
      // stuck for 5s. Fix 63: optimistic was removed.
    }
    // P1.29: if /clear was done lastClearTs increases → fully reset the local
    // chat and refill from the backend snapshot.
    // Fix 64 CRITICAL: overwrite chat ONLY on manual /clear or /compact reasons.
    // On internal session resets like "user_pause_interrupt" / "transient_retry"
    // / "transient_cleanup" do NOT OVERWRITE chat — the user's queued messages
    // (in the UI chat but not yet pushed to chat by the backend) would be lost.
    if (
      typeof status.lastClearTs === "number" &&
      status.lastClearTs > 0 &&
      status.lastClearTs !== this.lastClearTsSeen
    ) {
      this.lastClearTsSeen = status.lastClearTs;
      const reason = status.lastClearReason ?? "";
      // Fix 96: /clear fully resets chat (user intent = clear). /compact does NOT
      // delete the USER message — the UI already added the opt /compact message,
      // the backend pushChatFor "/compact" is no longer done (Fix 96 backend). In
      // this case OVERWRITING chat deletes the opt /compact and, since the user
      // "/compact" is not in the backend snapshot either, the user message is
      // completely lost from the screen. Solution: merge on the compact reason —
      // keep the current local chat, add the missing messages from the backend snapshot.
      if (reason === "user_clear") {
        this.chat = status.chat ?? [];
        this.streamIdx = -1;
        this.canliAktivite = [];
      } else if (reason.startsWith("compact:")) {
        // Keep the local /compact opt message. Append the missing
        // sef/agent_question/user_choice messages from the backend snapshot.
        const yerelTs = new Set(this.chat.map((m) => m.ts));
        for (const bm of status.chat ?? []) {
          if (bm.role === "kullanici" || bm.role === "otonom") continue;
          if (!yerelTs.has(bm.ts)) this.chat.push(bm as ChatMessage);
        }
        this.chat = [...this.chat];
        this.streamIdx = -1;
        this.canliAktivite = [];
      }
      // On internal session resets chat is untouched; the backend pushStatus chat
      // snapshot is merged later in the applyStatus flow anyway.
    }
    let yeniAktif = false;
    // Race guard: the user clicked to change sessions but the backend has not yet
    // switched to the target session -> this pushStatus belongs to the old session.
    // SKIP the chat reconcile, only update the sessions list/context info.
    const switching =
      this.pendingSessionSwitch !== null &&
      status.activeSessionId !== undefined &&
      status.activeSessionId !== this.pendingSessionSwitch;
    if (status.activeSessionId !== undefined) {
      yeniAktif = status.activeSessionId !== this.activeSessionId;
      // Fix 60c: do NOT REVERT activeSessionId during switching. Local
      // sessionSelect set it to pendingSessionSwitch; this value must be
      // preserved until the backend reply arrives. Otherwise runningHere is
      // computed wrong.
      if (!switching) {
        this.activeSessionId = status.activeSessionId;
      }
      if (yeniAktif && status.chat && !switching) {
        this.chat = status.chat;
        this.streamIdx = -1;
        this.canliAktivite = [];
      }
      // Reached the target session -> drop the flag.
      if (
        this.pendingSessionSwitch !== null &&
        status.activeSessionId === this.pendingSessionSwitch
      ) {
        this.pendingSessionSwitch = null;
      }
    }
    if (switching) {
      // Switch in progress: also skip the reconcile below.
      if (status.sessionsContext) {
        this.sessionsIsGlobal = !!status.sessionsContext.isGlobal;
      }
      return;
    }
    // RECONCILE: if the sef_cevap WS event is missed (race, network glitch) the
    // UI desyncs with the backend — the user cannot see the Architect's reply.
    // status.chat is the backend snapshot; merge it with the local chat on every
    // pushStatus. A NEW SESSION IS SKIPPED — chat was already force-loaded above;
    // the reconcile here could mistakenly add in-memory messages left from the old session.
    if (!yeniAktif && status.chat && status.chat.length) {
      const yerelTs = new Set(this.chat.map((m) => m.ts));
      // BUG FIX: the 80-char snippet dedup was insufficient in a race condition
      // (streaming text overwrite + backend snapshot produced a different snippet
      // → the same reply rendered twice, the user saw double tokens). Improvement:
      // (1) a full-text hash of all local chief messages; (2) if there is a local
      // chief message within the last 30 seconds, skip the backend snapshot — the
      // backend is not finalized yet but the UI ALREADY showed it.
      const NOW = Date.now();
      const RECENT_MS = 30_000;
      const yerelSefHash = new Set(
        this.chat
          .filter((m) => m.role === "sef")
          .map((m) => `${m.text.length}_${m.text.slice(0, 200)}`),
      );
      const recentSefTs = this.chat
        .filter((m) => m.role === "sef" && NOW - m.ts < RECENT_MS)
        .map((m) => m.ts);
      let degisti = false;
      for (const bm of status.chat) {
        // kullanici / otonom roles are already added on the UI side via
        // sendCommand; since the backend ts differs a duplicate message forms — skip these roles.
        if (bm.role === "kullanici" || bm.role === "otonom") continue;
        if (bm.role === "sef") {
          const txt = bm.text ?? "";
          // Mid-turn question fix: if there is a local chief bubble with the same
          // commandId (sealed + continuation split), the backend's single
          // full-text chief is the same reply for this turn — it does not match
          // due to the full-text hash split, so skip by commandId (so a late
          // refresh does not append a duplicate below). If there is no commandId
          // it is a no-op and falls to the hash/time checks below.
          const bmCid = (bm as ChatMessage).commandId;
          if (bmCid && this.chat.some((m) => m.role === "sef" && m.commandId === bmCid)) continue;
          const hash = `${txt.length}_${txt.slice(0, 200)}`;
          if (yerelSefHash.has(hash)) continue; // exact content match
          // If the backend ts is close to the ts of a local chief message within
          // the last 30s (streaming race) skip — local is already up to date.
          const nearRecent = recentSefTs.some((ts) => Math.abs(ts - bm.ts) < 60_000);
          if (nearRecent) continue;
          if (!yerelTs.has(bm.ts)) {
            this.chat.push(bm as ChatMessage);
            yerelSefHash.add(hash);
            degisti = true;
          }
          continue;
        }
        if (!yerelTs.has(bm.ts)) {
          // Fix DUP-QCARD: askId-based dedup for agent_question. Even if the
          // backend ts differs, if the same askId is already in chat do not stamp
          // a duplicate card — only update the answered/secim fields.
          if (bm.role === "agent_question" && bm.askId) {
            const existing = this.chat.find(
              (x) => x.role === "agent_question" && x.askId === bm.askId,
            );
            if (existing) {
              if ((bm as ChatMessage).answered && !existing.answered) {
                existing.answered = true;
                existing.secim = (bm as ChatMessage).secim;
                degisti = true;
              }
              continue;
            }
          }
          // Fix 105: askId-based dedup for user_choice too. cevaplaSoru() pushes
          // locally (Date.now() ts), the backend writes its own ts in
          // pushChatFor — since the ts do not match the reconcile was stamping a
          // duplicate card here. Skip if askId+secim are the same.
          if (bm.role === "user_choice" && bm.askId) {
            const existing = this.chat.find(
              (x) => x.role === "user_choice" && x.askId === bm.askId,
            );
            if (existing) continue;
          }
          this.chat.push(bm as ChatMessage);
          degisti = true;
        } else if (bm.role === "agent_question" && bm.answered) {
          // If answered on the backend but still open in the UI, synchronize
          const ym = this.chat.find((x) => x.ts === bm.ts);
          if (ym && !ym.answered) {
            ym.answered = true;
            ym.secim = (bm as ChatMessage).secim;
            degisti = true;
          }
        }
      }
      if (degisti) {
        // Sort by ts — so out-of-order additions land in the correct position
        this.chat.sort((a, b) => a.ts - b.ts);
        this.chat = [...this.chat];
      }
    }
    if (status.sessionsContext) {
      this.sessionsIsGlobal = !!status.sessionsContext.isGlobal;
    }
    // Expert read-only chat: the backend writes native Agent delegation to
    // registry.chat (ajan_komut=chief task, uzman=expert reply) and sends it via
    // status.specialistChats. The UI shows this read-only when the expert is clicked in the left panel.
    if (status.specialistChats) {
      this.specialistChats = status.specialistChats;
    }
    // Backend-UI sync — clears stale state after an orchestrator restart / WS
    // hiccup. If inFlight show Thinking, otherwise FORCE stop (clear
    // runTimer/segments even if running is false). Otherwise, when sef_cevap is
    // missed or a race occurs, the UI stays stuck in Thinking forever (user pain).
    // PAUSE GUARD: if paused=true never startRun; the UI must stay on the
    // "Paused" indicator. The backend already does not emit events while paused;
    // this guard also closes the applyStatus race.
    if (this.paused) {
      if (this.running || this.runTimer) this.stopRun();
      this.canliAktivite = [];
      return;
    }
    if (status.queue) {
      // Fix 60d CRITICAL: do the queue inFlight check ONLY for the current
      // activeSessionId. The old logic called startRun for any queue item and put
      // the NEW activeSessionId into optimistic — Thinking bound to the wrong
      // session. Now: if the queue item's sessionId is NOT equal to the current
      // active, inFlight is false (this session has no work).
      const inFlight = status.queue.some(
        (q: { status: string; sessionId?: string }) =>
          (q.status === "isleniyor" || q.status === "bekliyor") &&
          (!q.sessionId || q.sessionId === this.activeSessionId),
      );
      // Fix 63: startRun/stopRun no-op; running is tied to the runningHere getter.
      // The applyStatus runningSessions update is enough — it triggers the effect lifecycle.
      void inFlight;
    }
  }

  private setAgent(
    name: string,
    status: AgentStatus,
    task: string | null,
    assignedBy?: string,
  ): void {
    this.agents = this.agents.map((a) =>
      a.name === name
        ? { ...a, status, task, assignedBy: assignedBy ?? (status === "calisiyor" ? a.assignedBy : null) }
        : a,
    );
  }

  private applyEvent(ev: FeedEvent): void {
    ev.uid = ++this.feedSeq;
    this.feed = [ev, ...this.feed].slice(0, 200);
    const p = ev.payload;
    switch (ev.type) {
      case "delege_basladi":
        this.setAgent(String(p.agent), "calisiyor", String(p.task ?? ""), "Chief");
        break;
      case "peer_istek":
        this.setAgent(String(p.peer), "calisiyor", String(p.request ?? ""), "An expert");
        break;
      case "delege_bitti":
        this.setAgent(String(p.agent), p.isError ? "hata" : "bos", null);
        break;
      case "hata":
        if (p.agent) this.setAgent(String(p.agent), "hata", null);
        // During restart, do not show ConnectionRefused / API connection errors
        // to the user — wait for a silent reconnect.
        if (this.running && !this.restarting) {
          this.runError = String(p.mesaj ?? "Unknown error");
        }
        // NO notification — even on error we do not fire an OS notification until
        // sef_tamamen_idle arrives. Single notification point policy.
        break;
      case "ajan_durum_degisti": {
        // The backend emits this event when restart_self or rebuild_ui starts.
        // Show a "Restarting..." overlay in the UI ChatThread, handle WS
        // disconnects silently, and do not emit an error chip.
        const durum = String((p as { durum?: string }).durum ?? "");
        if (durum === "yeniden_baslatiliyor") {
          this.restarting = true;
          this.restartingExpiresAt = Date.now() + 60_000;
          this.runError = null;
          // Auto-close after 60s — the supervisor already rolls back at 45s, this
          // is the last resort against getting stuck forever.
          setTimeout(() => {
            if (Date.now() >= this.restartingExpiresAt) this.restarting = false;
          }, 60_000);
        }
        break;
      }
      case "worker_spawn":
        this.workers.push({
          id: ++this.workerSeq,
          task: String(p.task ?? `${p.count ?? 1} task(s)`),
          done: false,
          isError: false,
          transcript: "",
        });
        break;
      case "worker_done": {
        const w = this.workers.find((x) => !x.done);
        if (w) {
          w.done = true;
          w.isError = Boolean(p.isError);
          w.transcript = String(p.transcript ?? "");
        }
        this.workers = [...this.workers];
        break;
      }
      case "ajan_transcript":
        this.agents = this.agents.map((a) =>
          a.name === String(p.agent) ? { ...a, transcript: String(p.transcript ?? "") } : a,
        );
        break;
      case "token_guncelleme":
        // Persistent statistic — runTokens now arrives live via sef_token.
        this.tokensIn += Number(p.input ?? 0);
        this.tokensOut += Number(p.output ?? 0);
        break;
      case "commit":
        // NO notification — when the git_commit tool runs it does NOT fire an OS
        // notification. Otherwise on the Architect's multiple commits it would
        // seem like "work done" every time. Notification ONLY on sef_tamamen_idle.
        break;
      case "dosya_degisti":
        this.diffs = [
          {
            agent: String(p.agent),
            file: String(p.file),
            diff: String(p.diff ?? ""),
            ts: ev.ts,
          },
          ...this.diffs,
        ].slice(0, 100);
        break;
    }
  }
}
