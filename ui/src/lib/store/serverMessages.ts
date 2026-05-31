// ui/src/lib/store/serverMessages.ts — backend WS protocol messages.
// store.svelte.ts split: the Server*Message interfaces and the ServerMessage
// discriminated union live in a separate file. ProjectSession.handle parses
// this union with switch (msg.kind).
//
// No Svelte runes; a pure type-only module.

import type {
  AjanSoru,
  ChatMessage,
  ChatSegment,
  CostBreakdown,
  FeedEvent,
  ProjectStatus,
  ToolActivity,
} from "./types.js";

interface ServerEvent {
  kind: "event";
  event: FeedEvent;
}

interface ServerReply {
  kind: "sef_cevap";
  commandId: string;
  sessionId?: string;
  text: string;
  aktivite?: ToolActivity[];
  segments?: ChatSegment[];
  cost?: CostBreakdown;
  images?: string[];
  autonomous?: boolean;
  narrative?: string;
  autonomousFail?: boolean;
}

interface ServerPartial {
  kind: "sef_parcali";
  commandId: string;
  sessionId?: string;
  delta: string;
  reset?: boolean;
  autonomous?: boolean;
}

interface ServerAktivite {
  kind: "sef_aktivite";
  commandId: string;
  sessionId?: string;
  id: string;
  ad: string;
  durum: "calisiyor" | "bitti" | "hata";
  autonomous?: boolean;
}

interface ServerStatus {
  kind: "durum";
  payload: ProjectStatus;
}

interface ServerToken {
  kind: "sef_token";
  commandId: string;
  sessionId?: string;
  liveIn: number;
  liveOut: number;
  context: number;
  liveCacheRead?: number;
  liveCacheCreate1h?: number;
  liveCacheCreate5m?: number;
  liveUncached?: number;
  liveUsd?: number;
  sessionUsd?: number;
  model?: string;
  autonomous?: boolean;
}

interface ServerTurBasladi {
  kind: "sef_tur_basladi";
  commandId: string;
  sessionId?: string;
  autonomous?: boolean;
}

interface ServerIdle {
  kind: "sef_idle";
  commandId: string;
  sessionId?: string;
  autonomous?: boolean;
}

interface ServerTurBitti {
  kind: "sef_tur_bitti";
  commandId: string;
  sessionId?: string;
  autonomous: boolean;
  planYarim?: boolean;
}

interface ServerTamamenIdle {
  kind: "sef_tamamen_idle";
  commandId: string;
  sessionId?: string;
  autonomousFail?: boolean;
}

interface ServerAjanSoru extends AjanSoru {
  kind: "ajan_soru";
}

interface ServerCodegraphYanit {
  kind: "codegraph_yanit";
  reqId: string;
  ok: boolean;
  sonuc?: unknown;
  hata?: string;
}

interface ServerAktiviteToken {
  kind: "sef_aktivite_token";
  commandId: string;
  sessionId?: string;
  id: string;
  tokens: { in: number; out: number; cacheRead: number; cacheCreate: number; usd?: number };
}

// Fix 93: tool input/result mid-stream event.
interface ServerAktiviteIO {
  kind: "sef_aktivite_io";
  commandId: string;
  sessionId?: string;
  id: string;
  // Fix 128: "ilerleme" — subagent live progress text (goes to its owner Agent card).
  ioKind: "girdi" | "sonuc" | "ilerleme";
  text: string;
  hata?: boolean;
}

// F1.2 (Option B): ServerUzman* message types removed. The backend may still
// emit uzman_* events (backend cleanup in F1.3); the UI ignores them for now
// (no branch in the handle() switch). The direct UI expert chat UX was removed.

export type ServerMessage =
  | ServerEvent
  | ServerReply
  | ServerPartial
  | ServerAktivite
  | ServerAktiviteIO
  | ServerToken
  | ServerAjanSoru
  | ServerStatus
  | ServerTurBasladi
  | ServerIdle
  | ServerTurBitti
  | ServerTamamenIdle
  | ServerCodegraphYanit
  | ServerAktiviteToken;

// Types not separately exported can also be exported when needed; right now
// ProjectSession narrows types only via ServerMessage.
// (msg.kind = "..." checks are narrowed by the compiler.)

// Re-export ChatMessage for convenience (in handle/applyStatus pushes).
export type { ChatMessage };
