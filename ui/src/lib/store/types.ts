// ui/src/lib/store/types.ts — pure data types (UI store + WS protocol).
// store.svelte.ts split: type definitions are kept separate from class behavior.
// No Svelte runes; a pure type-only module.

export interface AgentInfo {
  name: string;
  role: string;
  model: string;
  effort: string;
  skills: string[];
}

export type AgentStatus = "bos" | "calisiyor" | "hata";

export interface AgentView extends AgentInfo {
  status: AgentStatus;
  task: string | null;
  assignedBy: string | null;
  transcript: string;
}

export interface QueueItem {
  id: string;
  text: string;
  status: string;
  sessionId?: string;
}

export interface FeedEvent {
  type: string;
  payload: Record<string, unknown>;
  ts: number;
  uid: number;
}

export interface WorkerView {
  id: number;
  task: string;
  done: boolean;
  isError: boolean;
  transcript: string;
}

// View of a temporary helper agent produced by the chief — a native Agent
// subagent (an isolated expert that writes code) OR a `task` worker. Shown in
// detail + live in the "Workers" section of the left panel. Data source: tool
// activities within chat segments (persistent) + canliAktivite (live) — NO
// extra backend/persistence field, and since chat is already persisted history
// is kept automatically.
export interface HelperView {
  id: string;
  kind: "agent" | "task";
  label: string; // Agent: subagent_type | task: description
  detail: string; // Agent: description/prompt | task: task
  model?: string; // task model (sonnet/opus/haiku)
  status: "running" | "done" | "error";
  result: string; // tool result (summary/full)
  progress?: string; // live progress text (introduced in Fix 128)
  tokens?: { in: number; out: number; cacheRead: number; cacheCreate: number; usd?: number };
  startTs?: number; // first "running" stamp — for the HelperCard elapsed indicator
}

export interface ToolActivity {
  // Fix 62: tool id — id-based match between canliAktivite and chat segments
  // (token update). Not present in old entries.
  id?: string;
  ad: string;
  girdi: string;
  sonuc: string;
  hata: boolean;
  // Fix 128: subagent (native Agent tool) live progress text — the SubagentInline
  // card shows a live step/text instead of "Thinking". Only for Agent tools.
  ilerleme?: string;
  // Fix 56: per-tool token attribution. The cost of the tool round.
  tokens?: {
    in: number;
    out: number;
    cacheRead: number;
    cacheCreate: number;
    usd?: number;
  };
}

// A time-ordered segment within a chat — to preserve the correct order between
// text blocks and tool batches (Claude Code style inline display). Not present
// in old messages; the ChatThread fallback renders them as plain text + activity.
export type ChatSegment =
  | { kind: "text"; text: string }
  | { kind: "tools"; tools: ToolActivity[] };

export interface CostBreakdown {
  in: number;
  out: number;
  cacheRead?: number;
  cacheCreate1h?: number;
  cacheCreate5m?: number;
  uncached?: number;
  usd?: number;
  model?: string;
}

export interface ChatMessage {
  role: "kullanici" | "sef" | "otonom" | "agent_question" | "user_choice" | "ajan_komut";
  text: string;
  ts: number;
  aktivite?: ToolActivity[];
  segments?: ChatSegment[];
  images?: string[];
  cost?: CostBreakdown;
  // Cross-agent command meta — UI badge.
  fromAgent?: string;
  // M4: the turn's 60-char summary intent — shown as italic gray text below the
  // tool batch.
  narrative?: string;
  // M1: a turn that shows subtype=success but has 0 in/0 out — UI red badge.
  autonomousFail?: boolean;
  // agent_question fields
  askId?: string;
  secenekler?: string[];
  cokluSecim?: boolean;
  serbestMetin?: boolean;
  answered?: boolean;
  secim?: string; // the user's choice once answered
  // P1.30: commandId — for sef_parcali/sef_cevap matching. commandId is written
  // to the entry of the message arriving via stream; the final sef_cevap finds
  // the entry by the same commandId (no race with streamIdx, does not overwrite
  // the wrong entry on queued replies).
  commandId?: string;
  // When an agent asks the user a question (ask_user_choice) mid-turn, the chief
  // bubble accumulated up to that moment is "sealed". After the answer, the
  // continued streaming opens a NEW bubble with the SAME commandId (BELOW the
  // question + choice card) — so the chat flows below the question and the reply
  // is not written over the old bubble. sef_parcali/sef_cevap matching skips
  // sealed=true bubbles.
  sealed?: boolean;
  // If the user message was added while the agent was running it is queued — the
  // UI shows a light green background + "Queued" badge. When the backend opens a
  // new turn (sef_tur_basladi) it flips the oldest queued message to false.
  queued?: boolean;
  // Fix 121: cut off before the turn completed (rebuild/restart/crash). A partial
  // written incrementally to disk during streaming — shows up on reload, the UI
  // stamps a "[incomplete — interrupted]" badge. Comes from
  // SessionChatEntry.incomplete on the backend.
  incomplete?: boolean;
  // Fix 125: actively streaming live draft flag (backend SessionChatEntry._live).
  // Set while the turn is STILL streaming; cleared when the turn is sealed/killed.
  // The "incomplete — interrupted" badge is NOT stamped while this flag is set —
  // so it works independent of list position (correct even when the user sends a
  // mid-turn message and the draft is not last).
  _live?: boolean;
}

export interface Attachment {
  ad: string;
  tur: "resim" | "dosya";
  mediaType?: string;
  veri: string;
}

export interface DiffEntry {
  agent: string;
  file: string;
  diff: string;
  ts: number;
}

export interface AutoRollbackInfo {
  ts: number;
  oldHash: string;
  newHash: string;
  status: "ok" | "skipped_same_hash" | "failed";
  detail?: string;
  trigger: {
    reason: string;
    category: string;
    fingerprint: string;
    count: number;
    immediate: boolean;
  };
}

export interface SessionInfo {
  id: string;
  name: string;
  role: "primary" | "secondary";
  createdAt: number;
  lastTurnTs: number;
  hasActivity: boolean;
}

// F1.2 (Option B): SpecialistChatEntry removed. The backend registry.ts
// SpecialistChatEntry is still disk-persisted (chat stays persistent), but the
// UI does not communicate directly with the expert.

export interface ProjectStatus {
  agents?: AgentInfo[];
  queue?: QueueItem[];
  chief?: { model: string; effort: string; fast?: boolean };
  chat?: ChatMessage[];
  context?: number;
  paused?: boolean;
  autoRollback?: AutoRollbackInfo | null;
  cost?: { sessionUsd?: number; hourlyUsd?: number };
  sessions?: SessionInfo[];
  activeSessionId?: string;
  activeQuerySessionId?: string | null;
  runningSessions?: string[];
  lastClearTs?: number;
  lastClearReason?: string;
  sessionsContext?: { isGlobal?: boolean };
  // F3 (autonomous 3-day mode): active/completed autonomous jobs. JobMonitor.svelte
  // reads this list.
  autonomousJobs?: AutonomousJob[];
  // F4 (Cost Control): live budget report — BudgetCard draws this.
  budgets?: BudgetReport;
  // Expert read-only chat: in native Agent delegation the task the chief sent
  // (ajan_komut) + the expert's reply (uzman) are kept in the registry and arrive
  // with status. The UI shows this read-only when the expert is clicked in the left panel.
  specialistChats?: Record<string, SpecialistChatEntry[]>;
}

// Same shape as orchestrator/registry.ts SpecialistChatEntry.
export interface SpecialistChatEntry {
  role: "kullanici" | "sef" | "ajan_komut" | "uzman";
  text: string;
  ts: number;
  transcript?: string;
  usage?: { input: number; output: number; usd?: number };
  hata?: boolean;
  fromAgent?: string;
}

// F4: BudgetCard data — one-to-one with orchestrator/budgetManager.ts BudgetReport.
export interface BudgetConfig {
  perAgentDailyUsd: number;
  perChiefDailyUsd: number;
  perMimarDailyUsd: number;
  hourlyBurnAlarmUsd: number;
  fallbackThresholdPct: number; // 0..1
}

export interface AgentBudgetStatus {
  agent: string;
  usd: number;
  capUsd: number;
  pctUsed: number;
  exceeded: boolean;
  atWarning: boolean;
}

export interface BudgetReport {
  config: BudgetConfig;
  agents: AgentBudgetStatus[];
  topSpenders: AgentBudgetStatus[];
  hourlyBurnUsd: number;
  hourlyAlarm: boolean;
  todayTotalUsd: number;
}

// F3 (autonomous 3-day mode): same shape as orchestrator/autonomousMode.ts.
// The backend serializes and sends it in the status payload; the UI JobMonitor
// card reads this type for status, counts, and button actions.
export interface AutonomousJob {
  id: string;
  sefProjectId: string;
  task: string;
  maxDays: number;
  startedAt: number;
  finishedAt?: number | null;
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  lastCheckpoint: number;
  lastCommitTs: number;
  commitsMade: number;
  filesChanged: number;
  filesChangedTotal: number;
  costUsdTotal: number;
  notifyOnComplete: boolean;
  consecutiveFailures: number;
  turnsTotal: number;
  lastProgressBroadcastTs: number;
  failReason?: string | null;
}

// F7: "durdur" added. Semantic distinction:
//   - duraklat = PAUSES the queue. The current turn finishes gracefully, and
//     following messages wait until "devam" arrives.
//   - durdur = cuts ONLY the current turn (SDK interrupt). The queue is NOT
//     paused; the next waiting message is processed immediately.
export type ControlAction = "duraklat" | "durdur" | "devam" | "plan_ac" | "plan_kapat";

export interface CanliAktivite {
  id: string;
  ad: string;
  durum: "calisiyor" | "bitti" | "hata";
  // Fix 62: mid-stream display of per-tool token attribution.
  tokens?: { in: number; out: number; cacheRead: number; cacheCreate: number; usd?: number };
  // Fix 93: tool input/result mid-stream.
  girdi?: string;
  sonuc?: string;
  hata?: boolean;
  // Fix 128: subagent live progress text (Agent tool card).
  ilerleme?: string;
}

export interface AjanSoru {
  askId: string;
  soru: string;
  secenekler: string[];
  cokluSecim: boolean;
  serbestMetin: boolean;
}
