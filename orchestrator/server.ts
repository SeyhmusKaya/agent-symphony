import { WebSocketServer, WebSocket } from "ws";
import type { EventBus, ArchitectEvent } from "./events.js";

export interface Attachment {
  ad: string;
  tur: "resim" | "dosya";
  mediaType?: string; // image: image/png etc.
  veri: string; // image: base64 (no prefix); file: raw text
}

export interface ClientMessage {
  kind:
    | "komut"
    | "durum_iste"
    | "kontrol"
    | "sef_model"
    | "uzman_model"
    | "kullanici_cevap"
    | "session_olustur"
    | "session_sec"
    | "session_sil"
    | "session_yeniden_adlandir"
    | "codegraph_iste"
    | "chat_history_iste"
    // F3 (otonom 3-gun modu)
    | "otonom_pause"
    | "otonom_resume"
    | "otonom_cancel"
    // F4 (Maliyet Kontrol)
    | "butce_cap"
    // Architect -> target agent: a controlled restart request (restart_agent tool).
    | "restart_iste";
  // F1.3b: the "ajan_mesaj" kind was removed — the UI specialist chat surface
  // was deleted in F1.2, the backend specialist subprocess flow in F1.3a/b.
  // Chat history (Fix 55): chat_history_iste {reqId, sessionId?, limit?}
  // if sessionId is not given ALL sessions are fetched; if given, only that one.
  // if limit is given, that many entries from the end (per session); otherwise all.
  sessionIdQ?: string;
  limit?: number;
  // CodeGraph query params (kind=codegraph_iste)
  reqId?: string;
  op?:
    | "stats"
    | "search"
    | "node"
    | "callers"
    | "callees"
    | "impact"
    | "imports"
    | "files"
    | "rebuild";
  params?: Record<string, unknown>;
  text?: string;
  ekler?: Attachment[];
  // F7: "durdur" = interrupt the current turn but do not pause the queue. duraklat
  // in its historical sense pauses the queue and finalizes the current turn.
  aksiyon?: "duraklat" | "durdur" | "devam" | "plan_ac" | "plan_kapat";
  model?: string;
  effort?: "low" | "medium" | "high";
  // Fast mode (priority service tier) toggle — comes with the sef_model message.
  fast?: boolean;
  agent?: string;
  askId?: string;
  cevap?: string;
  // Cross-agent call (talk_to_chief / sendCommandAwait) — the target agent
  // cannot call ask_user_choice (caller deadlock). The target decides itself.
  agentCall?: boolean;
  // For the "came from agent X" badge in the UI.
  fromAgent?: string;
  // session_olustur/sec/sil/yeniden_adlandir parameters
  sessionId?: string;
  sessionAd?: string;
  // P1.33: the cross-agent caller wants the backend to route to an empty
  // session. Primary > secondary idle > new session. When two callers ask the
  // same agent in parallel they are distributed across different sessions.
  routeToIdle?: boolean;
  // F3 (autonomous 3-day mode): pause/resume/cancel WS action, jobId arg.
  jobId?: string;
  // F4 (Cost Control): role + capUsd when setting a cap.
  role?: "chief" | "mimar" | "specialist" | "advisor" | "worker";
  capUsd?: number;
  // restart_iste — the restart note + continuation task sent by the Architect.
  restartNot?: string;
  restartDevam?: string;
}

export interface ToolActivity {
  // Fix 62: tool id — needed for matching with the parallel UI canliAktivite
  // inside segments (token update mid-stream).
  id?: string;
  ad: string; // tool name
  girdi: string; // input summary
  sonuc: string; // result summary
  hata: boolean;
  // Fix 56: per-tool token attribution. After the tool runs, reflects the usage
  // delta of the assistant message the SDK produces.
  // in = uncached + cacheCreate; out = output; cacheRead/cacheCreate raw.
  // The Anthropic API does not give per-tool tokens — round-based attribution.
  tokens?: {
    in: number;
    out: number;
    cacheRead: number;
    cacheCreate: number;
    usd?: number;
  };
}

// A time-ordered segment within the chat — to preserve the correct order
// between text blocks and tool batches. Absent in old messages; the UI fallback
// prints plain text + the tools list below it.
export type ChatSegment =
  | { kind: "text"; text: string }
  | { kind: "tools"; tools: ToolActivity[] };

export type ServerMessage =
  | { kind: "event"; event: ArchitectEvent }
  | {
      kind: "sef_cevap";
      commandId: string;
      // P1.33: which session's turn — so in parallel-session behavior the UI
      // does not push the event into the chatLog of a tab that does not own it.
      sessionId?: string;
      text: string;
      aktivite?: ToolActivity[];
      segments?: ChatSegment[];
      cost?: {
        in: number;
        out: number;
        // PROMPT 10 — cache-aware breakdown. The old 2 fields are backward compatible.
        cacheRead?: number;
        cacheCreate1h?: number;
        cacheCreate5m?: number;
        uncached?: number;
        usd?: number;
        model?: string;
      };
      images?: string[];
      autonomous?: boolean;
      // M4: the turn's 1-line (60 char) summary intent — derived from the first
      // line of the reply, italic gray text below the tool batch in the UI.
      narrative?: string;
      // M1: a turn that looks subtype=success but was actually not done (0 in/0 out
      // or error_during_execution). The UI shows this with a red badge.
      autonomousFail?: boolean;
    }
  | { kind: "sef_parcali"; commandId: string; sessionId?: string; delta: string; reset?: boolean; autonomous?: boolean }
  | { kind: "sef_tur_basladi"; commandId: string; sessionId?: string; autonomous?: boolean }
  | {
      kind: "sef_aktivite";
      commandId: string;
      sessionId?: string;
      id: string;
      ad: string;
      durum: "calisiyor" | "bitti" | "hata";
      autonomous?: boolean;
    }
  // Fix 93: transfer mid-stream tool input/result to the UI. The old sendAktivite
  // only sent ad+durum; input/result stayed embedded in the final sef_cevap
  // segments → when the UI opened a tool, "what it read/wrote" showed empty.
  | {
      kind: "sef_aktivite_io";
      commandId: string;
      sessionId?: string;
      id: string;
      // Fix 128: "ilerleme" — subagent live progress text (to its owner Agent card).
      ioKind: "girdi" | "sonuc" | "ilerleme";
      text: string;
      hata?: boolean;
    }
  // Fix 62: per-tool token attribution UI update. When the round delta is
  // computed the server fires this event; the UI updates canliAktivite[i].tokens
  // + the chat segments tool. Needed for the badge to show mid-stream.
  | {
      kind: "sef_aktivite_token";
      commandId: string;
      sessionId?: string;
      id: string;
      tokens: { in: number; out: number; cacheRead: number; cacheCreate: number; usd?: number };
    }
  | {
      kind: "sef_token";
      commandId: string;
      sessionId?: string;
      liveIn: number;
      liveOut: number;
      context: number;
      autonomous?: boolean;
      // Cache-aware breakdown (PROMPT 10). The old fields (liveIn, liveOut) are
      // kept backward compatible; these are extra detail.
      liveCacheRead?: number;
      liveCacheCreate1h?: number;
      liveCacheCreate5m?: number;
      liveUncached?: number;
      liveUsd?: number;
      sessionUsd?: number; // total accumulated over the process lifetime
      model?: string;
    }
  | { kind: "sef_idle"; commandId: string; sessionId?: string; autonomous?: boolean }
  // New: end of every runCommand (regardless of autonomous). The UI counts this
  // as "one turn finished"; does NOT fire a notification.
  | { kind: "sef_tur_bitti"; commandId: string; sessionId?: string; autonomous: boolean; planYarim?: boolean }
  // F1.3b: the uzman_* server message types were removed — the specialist
  // subprocess flow was deleted, the native Agent tool flows inline into the chief turn.
  // New: queue truly empty + autonomous chain done + no bgTask pending.
  // The UI notification fires ONLY on this.
  | { kind: "sef_tamamen_idle"; commandId: string; sessionId?: string; autonomousFail?: boolean }
  | {
      kind: "ajan_soru";
      askId: string;
      soru: string;
      secenekler: string[];
      cokluSecim: boolean;
      serbestMetin: boolean;
    }
  | { kind: "durum"; payload: unknown }
  // CodeGraph query response (Fix 53). UI codegraph_iste -> server codegraph_yanit.
  // reqId resolves the pending promise on the UI side.
  | { kind: "codegraph_yanit"; reqId: string; ok: boolean; sonuc?: unknown; hata?: string }
  // Fix 55: chat history response — { sessions: [{id, name, role, chat:[...] }] }.
  | { kind: "chat_history_yanit"; reqId: string; ok: boolean; sonuc?: unknown; hata?: string }
  // P1.33: the backend-side commandId+sessionId info of the cross-agent caller's
  // command. Sent only to the caller WS (NO broadcast). sendCommandAwait uses
  // this to filter sef_cevap broadcasts by commandId.
  | { kind: "komut_alindi"; commandId: string; sessionId: string }
  // restart_iste ack — so the Architect restart_agent caller knows it reached the target.
  | { kind: "restart_kabul" };

export interface ServerHandlers {
  // P1.33: commandId + sessionId are returned so the cross-agent caller can know
  // where its command landed. For commands coming from the UI this value is
  // ignored (it already receives it via the broadcast pushStatus).
  onCommand: (
    text: string,
    ekler?: Attachment[],
    // Fix 120: sessionId — stamps the session id active at the moment the UI
    // command was sent. The backend enqueues with this immutable id (instead of
    // the mutable getActiveId) → on a between-turn session change the message
    // does not fall into the wrong bucket.
    opts?: { agentCall?: boolean; fromAgent?: string; routeToIdle?: boolean; sessionId?: string },
  ) => { commandId: string; sessionId: string } | void;
  // Fix STOP-1: optional sessionId — the UI can target a specific session.
  // If not given, the handler targets all running sessions (backward compat).
  onControl: (
    aksiyon: "duraklat" | "durdur" | "devam" | "plan_ac" | "plan_kapat",
    sessionId?: string,
  ) => void;
  onSetModel: (model: string | undefined, effort: "low" | "medium" | "high" | undefined, fast?: boolean) => void;
  onSetAgentModel: (
    agent: string,
    model: string | undefined,
    effort: "low" | "medium" | "high" | undefined,
  ) => void;
  onUserAnswer: (askId: string, cevap: string) => void;
  // Multi-session — the user creates a new session with + from the right panel,
  // selects by clicking, deletes with - (secondary only).
  onSessionCreate: (ad?: string) => void;
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionRename: (sessionId: string, ad: string) => void;
  // F1.3b: onSpecialistMessage handler kaldirildi — UI artik specialist'le
  // dogrudan konusmuyor (F1.2), backend de specialist subprocess calistirmiyor.
  getStatus: () => unknown;
  // Fix 53: CodeGraph WS queries — UI'dan gelen op + params -> sonuc.
  onCodegraph?: (
    op: NonNullable<ClientMessage["op"]>,
    params: Record<string, unknown>,
  ) => Promise<{ ok: boolean; sonuc?: unknown; hata?: string }>;
  // Fix 55: chat history sorgusu — sessionId opsiyonel, limit opsiyonel.
  onChatHistory?: (
    sessionId?: string,
    limit?: number,
  ) => Promise<{ ok: boolean; sonuc?: unknown; hata?: string }>;
  // F3 (otonom 3-gun modu): UI sag panel buton aksiyonlari.
  onAutonomousAction?: (
    aksiyon: "pause" | "resume" | "cancel",
    jobId: string,
  ) => { ok: boolean; hata?: string };
  // F4 (Maliyet Kontrol): UI BudgetCard cap edit -> backend update + persist.
  onBudgetCap?: (
    role: "chief" | "mimar" | "specialist" | "advisor" | "worker",
    capUsd: number,
  ) => { ok: boolean; hata?: string };
  // Architect restart_agent -> a controlled restart of the target agent. The
  // target agent triggers its own supervisor restart flow via this handler.
  onRestartSelf?: (opts: { not?: string; devamGorevi?: string }) => void;
}

export class ArchitectServer {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(port: number, bus: EventBus, handlers: ServerHandlers) {
    this.wss = new WebSocketServer({ port });

    bus.on((event) => this.broadcast({ kind: "event", event }));

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      this.send(ws, { kind: "durum", payload: handlers.getStatus() });

      ws.on("message", (raw) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(raw.toString()) as ClientMessage;
        } catch {
          return;
        }
        if (msg.kind === "komut" && msg.text) {
          const r = handlers.onCommand(msg.text, msg.ekler, {
            agentCall: !!msg.agentCall,
            fromAgent: msg.fromAgent,
            routeToIdle: !!msg.routeToIdle,
            // Fix 120: if the UI command carries a stamped sessionId, forward it.
            sessionId: msg.sessionId,
          });
          // P1.33: send commandId+sessionId to the cross-agent caller (this WS only).
          if (r && msg.agentCall) {
            this.send(ws, { kind: "komut_alindi", commandId: r.commandId, sessionId: r.sessionId });
          }
        } else if (msg.kind === "durum_iste") {
          this.send(ws, { kind: "durum", payload: handlers.getStatus() });
        } else if (msg.kind === "kontrol" && msg.aksiyon) {
          // Fix STOP-1: if the control message carries a sessionId, target that session;
          // otherwise the handler targets all running sessions.
          handlers.onControl(msg.aksiyon, msg.sessionId);
        } else if (msg.kind === "sef_model") {
          handlers.onSetModel(msg.model, msg.effort, msg.fast);
        } else if (msg.kind === "uzman_model" && msg.agent) {
          handlers.onSetAgentModel(msg.agent, msg.model, msg.effort);
        } else if (msg.kind === "kullanici_cevap" && msg.askId) {
          handlers.onUserAnswer(msg.askId, msg.cevap ?? "");
        } else if (msg.kind === "session_olustur") {
          handlers.onSessionCreate(msg.sessionAd);
        } else if (msg.kind === "session_sec" && msg.sessionId) {
          handlers.onSessionSelect(msg.sessionId);
        } else if (msg.kind === "session_sil" && msg.sessionId) {
          handlers.onSessionDelete(msg.sessionId);
        } else if (
          msg.kind === "session_yeniden_adlandir" &&
          msg.sessionId &&
          msg.sessionAd
        ) {
          handlers.onSessionRename(msg.sessionId, msg.sessionAd);
        } else if (msg.kind === "codegraph_iste" && msg.op && msg.reqId) {
          // Fix 53: codegraph queries. Async — when the result arrives, the
          // response goes to this WS only instead of a broadcast.
          const reqId = msg.reqId;
          const op = msg.op;
          const params = msg.params ?? {};
          if (handlers.onCodegraph) {
            handlers.onCodegraph(op, params)
              .then((r) => this.send(ws, { kind: "codegraph_yanit", reqId, ok: r.ok, sonuc: r.sonuc, hata: r.hata }))
              .catch((e) => this.send(ws, { kind: "codegraph_yanit", reqId, ok: false, hata: (e as Error).message }));
          } else {
            this.send(ws, { kind: "codegraph_yanit", reqId, ok: false, hata: "codegraph_handler_yok" });
          }
        } else if (
          (msg.kind === "otonom_pause" || msg.kind === "otonom_resume" || msg.kind === "otonom_cancel") &&
          msg.jobId
        ) {
          // F3 (otonom 3-gun modu): UI sag panel butonlari.
          if (handlers.onAutonomousAction) {
            const aksiyon =
              msg.kind === "otonom_pause" ? "pause" : msg.kind === "otonom_resume" ? "resume" : "cancel";
            handlers.onAutonomousAction(aksiyon, msg.jobId);
          }
        } else if (
          msg.kind === "butce_cap" &&
          msg.role &&
          typeof msg.capUsd === "number" &&
          msg.capUsd >= 0
        ) {
          // F4 (Maliyet Kontrol): cap edit -> backend update + persist.
          if (handlers.onBudgetCap) {
            handlers.onBudgetCap(msg.role, msg.capUsd);
          }
        } else if (msg.kind === "chat_history_iste" && msg.reqId) {
          // Fix 55: chat history query. All sessions if sessionId is absent.
          const reqId = msg.reqId;
          const sessionId = msg.sessionIdQ;
          const limit = msg.limit;
          if (handlers.onChatHistory) {
            handlers.onChatHistory(sessionId, limit)
              .then((r) => this.send(ws, { kind: "chat_history_yanit", reqId, ok: r.ok, sonuc: r.sonuc, hata: r.hata }))
              .catch((e) => this.send(ws, { kind: "chat_history_yanit", reqId, ok: false, hata: (e as Error).message }));
          } else {
            this.send(ws, { kind: "chat_history_yanit", reqId, ok: false, hata: "chat_history_handler_yok" });
          }
        } else if (msg.kind === "restart_iste") {
          // Architect restart_agent -> this agent controlledly restarts itself.
          // Return the ack first (so the caller knows it reached), then the
          // handler self-exits within ~1.5sn.
          this.send(ws, { kind: "restart_kabul" });
          handlers.onRestartSelf?.({ not: msg.restartNot, devamGorevi: msg.restartDevam });
        }
      });

      ws.on("close", () => this.clients.delete(ws));
      ws.on("error", () => this.clients.delete(ws));
    });
  }

  sendChiefReply(
    commandId: string,
    text: string,
    aktivite?: ToolActivity[],
    cost?: {
      in: number;
      out: number;
      cacheRead?: number;
      cacheCreate1h?: number;
      cacheCreate5m?: number;
      uncached?: number;
      usd?: number;
      model?: string;
    },
    segments?: ChatSegment[],
    images?: string[],
    autonomous = false,
    extra?: { narrative?: string; autonomousFail?: boolean; sessionId?: string },
  ): void {
    this.broadcast({
      kind: "sef_cevap",
      commandId,
      sessionId: extra?.sessionId,
      text,
      aktivite,
      segments,
      cost,
      images: images && images.length ? images : undefined,
      autonomous,
      narrative: extra?.narrative,
      autonomousFail: extra?.autonomousFail,
    });
  }

  sendChiefPartial(commandId: string, delta: string, reset = false, autonomous = false, sessionId?: string): void {
    this.broadcast({ kind: "sef_parcali", commandId, sessionId, delta, reset, autonomous });
  }

  sendTurBasladi(commandId: string, autonomous = false, sessionId?: string): void {
    this.broadcast({ kind: "sef_tur_basladi", commandId, sessionId, autonomous });
  }

  sendAktivite(
    commandId: string,
    id: string,
    ad: string,
    durum: "calisiyor" | "bitti" | "hata",
    autonomous = false,
    sessionId?: string,
  ): void {
    this.broadcast({ kind: "sef_aktivite", commandId, sessionId, id, ad, durum, autonomous });
  }

  // Fix 93: tool girdi/sonuc mid-stream UI'a aktar.
  sendAktiviteIO(
    commandId: string,
    id: string,
    // Fix 128: "ilerleme" — subagent canli ilerleme metni.
    ioKind: "girdi" | "sonuc" | "ilerleme",
    text: string,
    hata = false,
    sessionId?: string,
  ): void {
    this.broadcast({ kind: "sef_aktivite_io", commandId, sessionId, id, ioKind, text, hata });
  }

  // Fix 62: tool tokens delta UI update.
  sendAktiviteTokens(
    commandId: string,
    id: string,
    tokens: { in: number; out: number; cacheRead: number; cacheCreate: number; usd?: number },
    sessionId?: string,
  ): void {
    this.broadcast({ kind: "sef_aktivite_token", commandId, sessionId, id, tokens });
  }

  sendAjanSoru(
    askId: string,
    soru: string,
    secenekler: string[],
    cokluSecim: boolean,
    serbestMetin: boolean,
  ): void {
    this.broadcast({
      kind: "ajan_soru",
      askId,
      soru,
      secenekler,
      cokluSecim,
      serbestMetin,
    });
  }

  sendChiefToken(
    commandId: string,
    liveIn: number,
    liveOut: number,
    context: number,
    autonomous = false,
    extra?: {
      liveCacheRead?: number;
      liveCacheCreate1h?: number;
      liveCacheCreate5m?: number;
      liveUncached?: number;
      liveUsd?: number;
      sessionUsd?: number;
      model?: string;
      sessionId?: string;
    },
  ): void {
    this.broadcast({
      kind: "sef_token",
      commandId,
      sessionId: extra?.sessionId,
      liveIn,
      liveOut,
      context,
      autonomous,
      ...(extra ?? {}),
    });
  }

  sendChiefIdle(commandId: string, autonomous = false, sessionId?: string): void {
    this.broadcast({ kind: "sef_idle", commandId, sessionId, autonomous });
  }

  // F1.3b: the sendUzman* methods were removed — no specialist subprocess flow.

  // New: notifies the end of a single runCommand. Does NOT fire a notification.
  sendTurBitti(commandId: string, autonomous: boolean, planYarim = false, sessionId?: string): void {
    this.broadcast({ kind: "sef_tur_bitti", commandId, sessionId, autonomous, planYarim });
  }

  // New: queue completely empty + autonomous chain done + no bgTask pending.
  // The UI notification fires ONLY on this. If autonomousFail=true the UI
  // tells the user via a red badge/notification that the turn was not actually done.
  sendTamamenIdle(commandId: string, autonomousFail = false, sessionId?: string): void {
    this.broadcast({ kind: "sef_tamamen_idle", commandId, sessionId, autonomousFail });
  }

  pushStatus(payload: unknown): void {
    this.broadcast({ kind: "durum", payload });
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(msg)); } catch { this.clients.delete(ws); }
    }
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(data); } catch { this.clients.delete(ws); }
      }
    }
  }

  close(): void {
    // First send a graceful close to all clients, then close the server.
    // 1000 = normal closure.
    for (const ws of this.clients) {
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, "server_closing");
        }
      } catch {
        /* yoksay */
      }
    }
    this.clients.clear();
    this.wss.close();
  }
}
