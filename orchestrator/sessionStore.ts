// Multi-session manager — Claude Code-style multiple session support for the
// Architect (and chiefs). Each session: its own sessionId, chatLog, context,
// $usd, compactSummary, loadedToolsets. The primary session CANNOT BE DELETED
// (Head Architect / Head Chief) and is always shown at the top. Other sessions
// the user creates with + and deletes with -. When the active session changes
// the active chief query is interrupted.
//
// Persistence:
//   .team/sessions/index.json     — { activeId, sessions: [meta...] }
//   .team/sessions/<id>/chief.json — { sessionId, loadedToolsets, lastClearReason, lastClearTs }
//   .team/sessions/<id>/chat.json  — ChatEntry[]
//   .team/sessions/<id>/state.json — { contextTokens, sessionUsd, compactSummary, lastTurnTs }

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

// Single ChatEntry — must be one-to-one compatible with the one used in main.ts.
// Redefined here, including narrative + autonomousFail.
export interface SessionChatEntry {
  // agent_question + user_choice: message roles persisted for the
  // ask_user_choice tool. The UI can redraw after restart/reload, nothing is lost.
  // ajan_komut: a message that came via cross-agent talk_to_chief (not the user).
  role: "kullanici" | "sef" | "otonom" | "agent_question" | "user_choice" | "ajan_komut";
  text: string;
  ts: number;
  aktivite?: Array<{ ad: string; girdi: string; sonuc: string; hata: boolean }>;
  segments?: Array<
    | { kind: "text"; text: string }
    | { kind: "tools"; tools: Array<{ ad: string; girdi: string; sonuc: string; hata: boolean }> }
  >;
  cost?: { in: number; out: number };
  images?: string[];
  narrative?: string;
  // ajan_komut metadata — who sent it (badge display in the UI).
  fromAgent?: string;
  // agent_question special fields
  askId?: string;
  secenekler?: string[];
  cokluSecim?: boolean;
  serbestMetin?: boolean;
  answered?: boolean;
  secim?: string;
  // Fix 64b: queue tracking — the msg pushed during onCommand enqueue.
  // queued=false is set when runCommand starts processing. The UI shows the
  // QUEUED badge via the queued flag. After a session-switch the backend
  // snapshot still includes this msg → it does not disappear from the UI.
  commandId?: string;
  queued?: boolean;
  // Fix 121: cut off before the turn completed (rebuild/restart/crash). This
  // entry is the "live draft" written incrementally to disk during streaming —
  // if the process dies mid-turn this half bubble shows on reload ("[half — cut off]").
  incomplete?: boolean;
  // Fix 121: live draft marker (the single entry at the end of the chat array).
  // If the turn ends normally/is stopped, the upserting side deletes it — the
  // final entry is pushed once by runCommand (no double display).
  _live?: boolean;
}

// A session's persistent state.
export interface SessionState {
  contextTokens: number;
  sessionUsd: number;
  compactSummary: string;
  lastTurnTs: number;
  // Per-session model + effort preference. null => the project-level default
  // (chiefModel) is used. If absent in old state.json files it comes undefined → falls back to default.
  model?: string | null;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
  // Fast mode (priority service tier). null/undefined => the project-level default.
  fast?: boolean | null;
  // Fix 95: after compact or pause/interrupt, the compactSummary needs to be
  // prepended to the start of the NEXT user message. Putting it in the system
  // prompt is not enough — the agent reads the summary as an "instruction", not
  // as "previous conversation history". When placed inline in the user message,
  // the Anthropic API sees it like prior conversation context and the agent
  // properly interprets it as "the user previously asked/I did these".
  // Set: true after runCompact; true after pause/interrupt.
  // Reset: false after the inject is done on the next user-directed turn.
  needsContextPrepend?: boolean;
  // At the moment compact runs, store the last N messages of chat.json (raw text).
  // The compact summary sometimes swallows detail (micro-turn info like "the user
  // asked this, the chief answered that"); the raw last-3 turn fragment compensates.
  // Valid only for 1 turn after pause/compact — deleted after the summary is injected.
  recentTurnsFragment?: string;
}

// A session's Chief sub-state (compatible with the old ChiefStore structure).
export interface SessionChief {
  sessionId: string | null;
  loadedToolsets: string[];
  lastClearReason: string | null;
  lastClearTs: number;
}

// Meta shown in the UI/list.
export interface SessionMeta {
  id: string;
  name: string;
  role: "primary" | "secondary";
  createdAt: number;
  lastTurnTs: number; // for sorting
  hasActivity: boolean;
}

// All data of all sessions.
export interface SessionRecord {
  meta: SessionMeta;
  chief: SessionChief;
  chat: SessionChatEntry[];
  state: SessionState;
}

interface IndexFile {
  activeId: string;
  sessions: SessionMeta[];
}

// Generate a 2-3 word smart title from a secondary session's first user
// message. No LLM call — pure text processing. Zero token cost.
function smartTitle(text: string): string {
  // Clean markdown, URL, code block
  const clean = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#*_~>\[\]]/g, "")
    .trim();

  // First sentence or line
  const sentence = clean.split(/[.!?\n]/)[0].trim();

  // Turkish + English stopword list
  const STOP = new Set([
    "bir", "ve", "ile", "icin", "için", "bu", "su", "şu", "de", "da", "ki",
    "mi", "mu", "mı", "mü", "ne", "var", "yok", "bana", "sana", "bunu",
    "the", "a", "an", "in", "on", "at", "to", "for", "of", "is", "it",
    "be", "do", "go", "can", "will", "that", "this", "and", "or", "but",
  ]);

  const words = sentence
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ0-9]/g, ""))
    .filter((w) => w.length > 1 && !STOP.has(w.toLowerCase()));

  const title = words.slice(0, 3).join(" ").trim();
  return title.slice(0, 40) || sentence.slice(0, 40) || "New session";
}

const EMPTY_STATE: SessionState = {
  contextTokens: 0,
  sessionUsd: 0,
  compactSummary: "",
  lastTurnTs: 0,
};

const EMPTY_CHIEF: SessionChief = {
  sessionId: null,
  loadedToolsets: [],
  lastClearReason: null,
  lastClearTs: 0,
};

function readJson<T>(path: string, def: T): T {
  if (!existsSync(path)) return def;
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (!raw) return def;
    return JSON.parse(raw) as T;
  } catch {
    return def;
  }
}

function writeJson(path: string, value: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

export class SessionStore {
  private teamDir: string;
  private indexPath: string;
  private sessionsDir: string;
  private records = new Map<string, SessionRecord>();
  // Fix 148b: a one-shot "FORCE native compaction on the next turn" flag.
  // Manual /compact + safety-net set it; runChiefAttempt consumes it when the
  // turn starts and pulls autoCompactWindow to the floor (100k) for that turn ->
  // native compacts WITHIN THE SAME session. In-memory (no persist needed, short-lived).
  private forceCompactSet = new Set<string>();
  private activeId: string;
  // primary label — "Head Architect" for the Architect, "Head Chief" for a project chief.
  private primaryLabel: string;

  constructor(teamDir: string, primaryLabel: string) {
    this.teamDir = teamDir;
    this.sessionsDir = join(teamDir, "sessions");
    this.indexPath = join(this.sessionsDir, "index.json");
    this.primaryLabel = primaryLabel;
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
    this.activeId = "";
    this.load();
    this.migrateLegacy();
    this.ensurePrimary();
  }

  // If old .team/chief.json + .team/chat.json exist, move them to the primary session.
  private migrateLegacy(): void {
    const legacyChief = join(this.teamDir, "chief.json");
    const legacyChat = join(this.teamDir, "chat.json");
    const hasLegacy = existsSync(legacyChief) || existsSync(legacyChat);
    if (!hasLegacy) return;
    // Is there a primary? Create one if not.
    let primary = this.findPrimary();
    if (!primary) {
      const id = randomUUID();
      primary = {
        meta: {
          id,
          name: this.primaryLabel,
          role: "primary",
          createdAt: Date.now(),
          lastTurnTs: 0,
          hasActivity: false,
        },
        chief: { ...EMPTY_CHIEF },
        chat: [],
        state: { ...EMPTY_STATE },
      };
      this.records.set(id, primary);
      this.activeId = id;
    }
    // Migrate chief.
    if (existsSync(legacyChief)) {
      try {
        const old = JSON.parse(readFileSync(legacyChief, "utf8")) as {
          sessionId?: string;
          loadedToolsets?: string[];
          lastClearReason?: string;
          lastClearTs?: number;
        };
        primary.chief.sessionId = old.sessionId ?? null;
        primary.chief.loadedToolsets = old.loadedToolsets ?? [];
        primary.chief.lastClearReason = old.lastClearReason ?? null;
        primary.chief.lastClearTs = old.lastClearTs ?? 0;
      } catch {
        /* ignore */
      }
      try {
        renameSync(legacyChief, legacyChief + ".migrated");
      } catch {
        /* ignore */
      }
    }
    // Migrate chat.
    if (existsSync(legacyChat)) {
      try {
        const oldChat = JSON.parse(readFileSync(legacyChat, "utf8")) as SessionChatEntry[];
        if (Array.isArray(oldChat) && oldChat.length) {
          primary.chat = oldChat;
          primary.meta.hasActivity = true;
          const lastTs = oldChat[oldChat.length - 1]?.ts ?? 0;
          primary.meta.lastTurnTs = lastTs;
          primary.state.lastTurnTs = lastTs;
        }
      } catch {
        /* ignore */
      }
      try {
        renameSync(legacyChat, legacyChat + ".migrated");
      } catch {
        /* ignore */
      }
    }
    // If old compact.json + context.json exist, move them to state.
    const legacyCompact = join(this.teamDir, "compact.json");
    const legacyContext = join(this.teamDir, "context.json");
    if (existsSync(legacyCompact)) {
      try {
        const c = JSON.parse(readFileSync(legacyCompact, "utf8")) as {
          summary?: string;
        };
        primary.state.compactSummary = c.summary ?? "";
      } catch {
        /* ignore */
      }
      try {
        renameSync(legacyCompact, legacyCompact + ".migrated");
      } catch {
        /* ignore */
      }
    }
    if (existsSync(legacyContext)) {
      try {
        const c = JSON.parse(readFileSync(legacyContext, "utf8")) as {
          context?: number;
        };
        primary.state.contextTokens = c.context ?? 0;
      } catch {
        /* ignore */
      }
      try {
        renameSync(legacyContext, legacyContext + ".migrated");
      } catch {
        /* ignore */
      }
    }
    this.persistAll();
  }

  private ensurePrimary(): void {
    if (this.findPrimary()) {
      if (!this.activeId || !this.records.has(this.activeId)) {
        const p = this.findPrimary();
        if (p) this.activeId = p.meta.id;
      }
      return;
    }
    // Zero state — create primary, make it active.
    const id = randomUUID();
    const rec: SessionRecord = {
      meta: {
        id,
        name: this.primaryLabel,
        role: "primary",
        createdAt: Date.now(),
        lastTurnTs: 0,
        hasActivity: false,
      },
      chief: { ...EMPTY_CHIEF },
      chat: [],
      state: { ...EMPTY_STATE },
    };
    this.records.set(id, rec);
    this.activeId = id;
    this.persistAll();
  }

  // P1.31: public helper — route autonomous/system turns to primary.
  getPrimaryId(): string | null {
    for (const r of this.records.values()) {
      if (r.meta.role === "primary") return r.meta.id;
    }
    return null;
  }

  private findPrimary(): SessionRecord | undefined {
    for (const r of this.records.values()) {
      if (r.meta.role === "primary") return r;
    }
    return undefined;
  }

  private load(): void {
    if (!existsSync(this.indexPath)) return;
    const idx = readJson<IndexFile | null>(this.indexPath, null);
    if (!idx) return;
    this.activeId = idx.activeId ?? "";
    for (const meta of idx.sessions ?? []) {
      const dir = join(this.sessionsDir, meta.id);
      const chief = readJson<SessionChief>(join(dir, "chief.json"), { ...EMPTY_CHIEF });
      const chat = readJson<SessionChatEntry[]>(join(dir, "chat.json"), []);
      const state = readJson<SessionState>(join(dir, "state.json"), { ...EMPTY_STATE });
      this.records.set(meta.id, { meta, chief, chat, state });
    }
  }

  private persistMeta(): void {
    const sessions = [...this.records.values()].map((r) => r.meta);
    writeJson(this.indexPath, { activeId: this.activeId, sessions });
  }

  private persistRecord(rec: SessionRecord): void {
    const dir = join(this.sessionsDir, rec.meta.id);
    writeJson(join(dir, "chief.json"), rec.chief);
    writeJson(join(dir, "chat.json"), rec.chat);
    writeJson(join(dir, "state.json"), rec.state);
  }

  private persistAll(): void {
    this.persistMeta();
    for (const rec of this.records.values()) this.persistRecord(rec);
  }

  // --- Public API ---

  getActiveId(): string {
    return this.activeId;
  }

  getActive(): SessionRecord {
    const r = this.records.get(this.activeId);
    if (!r) throw new Error("No active session");
    return r;
  }

  list(): SessionMeta[] {
    // Primary always at top, the rest by descending lastTurnTs.
    const all = [...this.records.values()].map((r) => r.meta);
    return all.sort((a, b) => {
      if (a.role === "primary") return -1;
      if (b.role === "primary") return 1;
      return b.lastTurnTs - a.lastTurnTs;
    });
  }

  getById(id: string): SessionRecord | undefined {
    return this.records.get(id);
  }

  // Create a new secondary session — make it active.
  create(name?: string): SessionMeta {
    const id = randomUUID();
    const idx = [...this.records.values()].filter((r) => r.meta.role === "secondary").length + 1;
    const rec: SessionRecord = {
      meta: {
        id,
        name: name?.trim() || `New session ${idx}`,
        role: "secondary",
        createdAt: Date.now(),
        lastTurnTs: 0,
        hasActivity: false,
      },
      chief: { ...EMPTY_CHIEF },
      chat: [],
      state: { ...EMPTY_STATE },
    };
    this.records.set(id, rec);
    this.activeId = id;
    this.persistRecord(rec);
    this.persistMeta();
    return rec.meta;
  }

  // Change the active session.
  activate(id: string): SessionMeta | null {
    const r = this.records.get(id);
    if (!r) return null;
    // When the user leaves the active session, mark it "seen".
    const prev = this.records.get(this.activeId);
    if (prev && prev.meta.id !== id) {
      prev.meta.hasActivity = false;
    }
    this.activeId = id;
    // The user entered this session — mark it "seen".
    r.meta.hasActivity = false;
    this.persistMeta();
    return r.meta;
  }

  // Delete a secondary. The primary is not deleted. If active, make primary active.
  remove(id: string): boolean {
    const r = this.records.get(id);
    if (!r) return false;
    if (r.meta.role === "primary") return false;
    this.records.delete(id);
    if (this.activeId === id) {
      const p = this.findPrimary();
      this.activeId = p ? p.meta.id : "";
    }
    // Clean up the disk.
    try {
      rmSync(join(this.sessionsDir, id), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    this.persistMeta();
    return true;
  }

  rename(id: string, name: string): boolean {
    const r = this.records.get(id);
    if (!r) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;
    r.meta.name = trimmed.slice(0, 80);
    this.persistMeta();
    return true;
  }

  // P1.32: by-id variants — for parallel session runs. runChiefAttempt writes
  // to the target session without changing the active session. The old "active"
  // APIs are preserved (the UI changes active via session-switch, command
  // history shows there).
  setSessionIdFor(id: string, sessionId: string): void {
    const r = this.records.get(id);
    if (!r) return;
    r.chief.sessionId = sessionId;
    this.persistRecord(r);
  }
  clearSessionIdFor(id: string, reason: string = "bilinmiyor"): void {
    const r = this.records.get(id);
    if (!r) return;
    // Fix 151 + Fix 154 (USER DIRECTIVE revised): does not change for automatic
    // reasons that create SDK session AMNESIA. silent_empty / transient_retry /
    // transient_cleanup -> NO-OP (these caused context loss, preserved).
    // EXCEPTION: "compact:*" -> ACTUALLY reset. The compact summary carries to
    // the next turn via needsContextPrepend, so the chief does NOT FORGET (CC-exact).
    // Because native compaction fires UNRELIABLY (1 success / 7 backstop), the
    // legacy backstop must be able to actually lower the context; without reset
    // it produced a summary but kept all history on top -> the context never
    // shrank. user_clear deletes too.
    if (reason !== "user_clear" && !reason.startsWith("compact:")) {
      r.chief.lastClearReason = `noop:${reason}`;
      r.chief.lastClearTs = Date.now();
      return;
    }
    r.chief.sessionId = null;
    r.chief.lastClearReason = reason;
    r.chief.lastClearTs = Date.now();
    this.persistRecord(r);
  }
  getSessionIdFor(id: string): string | null {
    return this.records.get(id)?.chief.sessionId ?? null;
  }
  getStateFor(id: string): SessionState | null {
    return this.records.get(id)?.state ?? null;
  }
  getLoadedToolsetsFor(id: string): string[] {
    return [...(this.records.get(id)?.chief.loadedToolsets ?? [])];
  }
  pushChatFor(id: string, entry: SessionChatEntry): void {
    const r = this.records.get(id);
    if (!r) return;
    // Auto-title: secondary session'da henuz hic mesaj yokken ilk kullanici
    // mesaji gelince akilli baslik uret (default "Yeni session X"'i degistir).
    // NOT: hasActivity yerine chat.length===0 kullaniyoruz — activate() artik
    // hasActivity'i temizlediginden, kullanici mevcut sessiondan ayrilip
    // donunce yeniden baslik uretilmesini engellemek icin.
    if (
      entry.role === "kullanici" &&
      r.meta.role === "secondary" &&
      r.chat.length === 0 &&
      entry.text?.trim()
    ) {
      r.meta.name = smartTitle(entry.text);
    }
    r.chat.push(entry);
    // Fix 71: 100 → 30. Lightens UI/disk; LLM context is SDK resume based
    // (reads from jsonl), this slice does not affect LLM tokens. UI history is enough.
    if (r.chat.length > 30) r.chat = r.chat.slice(-30);
    r.meta.hasActivity = true;
    r.meta.lastTurnTs = entry.ts;
    r.state.lastTurnTs = entry.ts;
    this.persistRecord(r);
    this.persistMeta();
  }
  getChatFor(id: string): SessionChatEntry[] {
    return this.records.get(id)?.chat ?? [];
  }
  saveChatFor(id: string): void {
    const r = this.records.get(id);
    if (r) this.persistRecord(r);
  }

  // Fix 121: write the half turn accumulating during streaming incrementally to
  // disk. Updates the single "_live" entry at the END of the chat array in place
  // (does NOT push a new entry for each delta — the array does not bloat). If the
  // process dies mid-turn (rebuild/crash) this entry stays in chat.json → a half
  // bubble shows on reload. The role/text/segments/aktivite fields have the same
  // shape as a completed turn — the UI draws the same bubble. The cap (30) also
  // covers the live entry so there is no special slice.
  upsertLiveDraftFor(id: string, entry: SessionChatEntry): void {
    const r = this.records.get(id);
    if (!r) return;
    const last = r.chat[r.chat.length - 1];
    if (last && last._live) {
      r.chat[r.chat.length - 1] = { ...entry, _live: true, incomplete: true };
    } else {
      r.chat.push({ ...entry, _live: true, incomplete: true });
      if (r.chat.length > 30) r.chat = r.chat.slice(-30);
    }
    r.meta.hasActivity = true;
    r.meta.lastTurnTs = entry.ts;
    r.state.lastTurnTs = entry.ts;
    this.persistRecord(r);
  }

  // Fix 121: delete the live draft. Called if the turn ends NORMALLY or is
  // gracefully cut off via stop/pause — in these cases runCommand ALREADY pushes
  // the final/partial entry; if we leave the live draft it shows twice.
  // Fix 125: previously only the _live at the END of the chat was popped. When
  // the user sends a new message while the turn is streaming, pushChatFor put the
  // user entry BELOW the _live draft → the draft was no longer last → it was not
  // popped → a persistent "half" history entry remained. Now the _live entry is
  // removed with splice WHEREVER it is (at most one exists).
  clearLiveDraftFor(id: string): void {
    const r = this.records.get(id);
    if (!r) return;
    const idx = r.chat.findIndex((e) => e._live);
    if (idx !== -1) {
      r.chat.splice(idx, 1);
      this.persistRecord(r);
    }
  }

  // Fix 121: called at boot. When the previous process was hard-killed
  // (rebuild/crash) mid-turn, a _live draft remains at the end of the chat.
  // Remove the _live flag (incomplete is preserved) → the next turn's
  // upsertLiveDraftFor does NOT ACCIDENTALLY overwrite this half bubble; it
  // becomes a persistent "half — cut off" history entry.
  sealLiveDraftsOnBoot(): void {
    let changed = false;
    for (const r of this.records.values()) {
      const last = r.chat[r.chat.length - 1];
      if (last && last._live) {
        delete last._live;
        last.incomplete = true;
        this.persistRecord(r);
        changed = true;
      }
    }
    if (changed) this.persistMeta();
  }
  setContextFor(id: string, tokens: number): void {
    const r = this.records.get(id);
    if (!r) return;
    r.state.contextTokens = tokens;
    this.persistRecord(r);
  }
  setCompactFor(id: string, summary: string): void {
    const r = this.records.get(id);
    if (!r) return;
    r.state.compactSummary = summary;
    this.persistRecord(r);
  }

  // Fix 95: a flag to prepend compactSummary + the last turn fragment to the
  // user prompt on the next user turn. recentTurnsFragment may be null/empty
  // (in pause/compact-only cases).
  setNeedsContextPrependFor(id: string, recentTurnsFragment: string = ""): void {
    const r = this.records.get(id);
    if (!r) return;
    r.state.needsContextPrepend = true;
    r.state.recentTurnsFragment = recentTurnsFragment;
    this.persistRecord(r);
  }

  // Lower the flag after the inject is done. Clear recentTurnsFragment.
  clearNeedsContextPrependFor(id: string): void {
    const r = this.records.get(id);
    if (!r) return;
    r.state.needsContextPrepend = false;
    r.state.recentTurnsFragment = "";
    this.persistRecord(r);
  }

  // Fix 148b: force native compaction for the next turn (manual /compact +
  // safety-net). Consumed via consumeForceCompactFor when the turn starts.
  requestForceCompactFor(id: string): void {
    this.forceCompactSet.add(id);
  }
  consumeForceCompactFor(id: string): boolean {
    return this.forceCompactSet.delete(id);
  }

  getNeedsContextPrependFor(id: string): { needs: boolean; fragment: string } {
    const r = this.records.get(id);
    if (!r) return { needs: false, fragment: "" };
    return {
      needs: !!r.state.needsContextPrepend,
      fragment: r.state.recentTurnsFragment ?? "",
    };
  }
  addUsdFor(id: string, delta: number): void {
    const r = this.records.get(id);
    if (!r) return;
    r.state.sessionUsd += delta;
    this.persistRecord(r);
  }

  // Update the active session's Chief sub-state. A thin adaptor mimicking the
  // old ChiefStore API — to keep main.ts's change surface small.
  setSessionId(sessionId: string): void {
    const r = this.getActive();
    r.chief.sessionId = sessionId;
    this.persistRecord(r);
  }

  clearSessionId(reason: string = "bilinmiyor"): void {
    const r = this.getActive();
    // Fix 151 + Fix 154: see clearSessionIdFor — "user_clear" and "compact:*"
    // actually delete (the compact summary carries, no amnesia); others NO-OP.
    if (reason !== "user_clear" && !reason.startsWith("compact:")) {
      r.chief.lastClearReason = `noop:${reason}`;
      r.chief.lastClearTs = Date.now();
      return;
    }
    r.chief.sessionId = null;
    r.chief.lastClearReason = reason;
    r.chief.lastClearTs = Date.now();
    this.persistRecord(r);
  }

  getSessionId(): string | null {
    return this.getActive().chief.sessionId;
  }

  getLastClearReason(): { reason: string | null; ts: number } {
    const c = this.getActive().chief;
    return { reason: c.lastClearReason, ts: c.lastClearTs };
  }

  getLastClearReasonFor(id: string): { reason: string | null; ts: number } {
    const r = this.records.get(id);
    if (!r) return { reason: null, ts: 0 };
    return { reason: r.chief.lastClearReason, ts: r.chief.lastClearTs };
  }

  getLoadedToolsets(): string[] {
    return [...this.getActive().chief.loadedToolsets];
  }

  addLoadedToolsets(groups: string[]): string[] {
    const r = this.getActive();
    const cur = new Set(r.chief.loadedToolsets);
    for (const g of groups) cur.add(g);
    r.chief.loadedToolsets = [...cur];
    this.persistRecord(r);
    return [...cur];
  }

  removeLoadedToolsets(groups: string[]): string[] {
    const r = this.getActive();
    const cur = new Set(r.chief.loadedToolsets);
    for (const g of groups) cur.delete(g);
    r.chief.loadedToolsets = [...cur];
    this.persistRecord(r);
    return [...cur];
  }

  // ChatLog operations.
  getChat(): SessionChatEntry[] {
    return this.getActive().chat;
  }

  pushChat(entry: SessionChatEntry): void {
    const r = this.getActive();
    // Auto-title: generate a smart title on the first user message when a
    // secondary session has no messages. We use chat.length===0 (not hasActivity
    // — since activate() clears it, staying false is not reliable).
    if (
      entry.role === "kullanici" &&
      r.meta.role === "secondary" &&
      r.chat.length === 0 &&
      entry.text?.trim()
    ) {
      r.meta.name = smartTitle(entry.text);
    }
    r.chat.push(entry);
    // Fix 71: 100 → 30. Lightens UI/disk; LLM context is SDK resume based
    // (reads from jsonl), this slice does not affect LLM tokens. UI history is enough.
    if (r.chat.length > 30) r.chat = r.chat.slice(-30);
    r.meta.hasActivity = true;
    r.meta.lastTurnTs = entry.ts;
    r.state.lastTurnTs = entry.ts;
    this.persistRecord(r);
    this.persistMeta();
  }

  saveChat(): void {
    this.persistRecord(this.getActive());
  }

  // State (context/usd/compact) ops.
  getState(): SessionState {
    return this.getActive().state;
  }

  setContext(tokens: number): void {
    const r = this.getActive();
    r.state.contextTokens = tokens;
    this.persistRecord(r);
  }

  setCompact(summary: string): void {
    const r = this.getActive();
    r.state.compactSummary = summary;
    this.persistRecord(r);
  }

  addUsd(delta: number): void {
    const r = this.getActive();
    r.state.sessionUsd += delta;
    this.persistRecord(r);
  }

  setLastTurnTs(ts: number): void {
    const r = this.getActive();
    r.state.lastTurnTs = ts;
    r.meta.lastTurnTs = ts;
    this.persistRecord(r);
    this.persistMeta();
  }

  // --- Per-session model/effort ---
  // null => use the project-level default (chiefModel/chiefEffort). Old sessions
  // (state.model undefined) backward compat: the caller applies the fallback.
  getModelFor(id: string): { model: string | null; effort: "low" | "medium" | "high" | "xhigh" | "max" | null; fast: boolean | null } {
    const r = this.records.get(id);
    if (!r) return { model: null, effort: null, fast: null };
    return {
      model: r.state.model ?? null,
      effort: r.state.effort ?? null,
      fast: r.state.fast ?? null,
    };
  }
  setModelFor(id: string, model: string | null, effort: "low" | "medium" | "high" | "xhigh" | "max" | null, fast?: boolean | null): boolean {
    const r = this.records.get(id);
    if (!r) return false;
    r.state.model = model;
    r.state.effort = effort;
    if (fast !== undefined) r.state.fast = fast;
    this.persistRecord(r);
    return true;
  }
}
