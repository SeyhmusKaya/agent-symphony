// sessionQuery.ts — Fix 138 (Async delegation B): per-session PERSISTENT streaming
// query manager. The chief query is normally SINGLE-TURN (runChiefAttempt opens a
// query() on each call and closes it at the result). For background specialist
// delegation the query needs to stay ALIVE across turns: the native
// Agent(background:true) subagent is a CHILD of the chief query subprocess — when
// the query tears down so does it. In B the query stays persistent, the bg subagent
// keeps working, and when it finishes a task_notification arrives, the host enqueues
// a follow-up turn on the SAME session (queue-based auto-resume) — the chief wakes
// up and acts based on the result.
//
// DESIGN (single-pump): a persistent query can have only ONE consumer (for await).
// So there is a SINGLE pump loop per conn that reads and routes messages:
//   - task_started/task_notification/task_progress (system) -> task lifecycle
//     (bg mapping + onBgComplete when done). Processed INDEPENDENTLY of the active turn.
//   - every other message -> the active turn's handle(msg) (if none, idle, ignore).
// Turn = set up active handler + push user message + markDone at the result. The pump
// never closes (until conn.alive=false or the query ends).
//
// SAFETY: this whole path only kicks in when ARCHITECT_PERSISTENT=1
// (gated in runChiefAttempt). Flag OFF -> old per-turn behavior, this module
// is never used. So the default system stays on the proven path.

import type { Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "../logger.js";

// Pushable async iterable — the SDK streaming-input prompt. The SDK consumes it
// with `for await`; push() injects a new user turn, when empty next() waits
// (the query stays alive), end() closes it.
export class PushQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private resolvers: Array<(r: IteratorResult<T>) => void> = [];
  private ended = false;

  push(item: T): void {
    if (this.ended) return;
    const r = this.resolvers.shift();
    if (r) r({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    let r: ((r: IteratorResult<T>) => void) | undefined;
    while ((r = this.resolvers.shift())) {
      r({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.items.length) {
          return Promise.resolve({ value: this.items.shift() as T, done: false });
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise((res) => this.resolvers.push(res));
      },
    };
  }
}

export interface BgCompleteInfo {
  specialist?: string;
  summary: string;
  outputFile: string;
  status: "completed" | "failed" | "stopped" | string;
}

export interface SessionConn {
  sid: string;
  query: Query;
  input: PushQueue<SDKUserMessage>;
  abortController: AbortController;
  // The structural signature the conn was created with (systemPrompt + model + tools +
  // agents + mcp + cwd...). Recomputed at the start of each turn; if it changes the
  // conn is closed and recreated (load_toolset / model switch / /compact / new specialist).
  signature: string;
  alive: boolean;
  // task_id -> bg specialist info (filled at task_started, deleted at notification).
  bgTasks: Map<string, { specialist?: string; toolUseId?: string }>;
  // Agent tool_use ids invoked with background:true. task_notification triggers
  // "bg done -> resume" only for these; a foreground subagent's notification flows
  // normally within the turn (NO resume).
  bgToolUseIds: Set<string>;
}

export interface SessionQueryManagerOpts {
  logger: Logger;
  // Called when the bg specialist finishes (idle or during the next turn) — the host
  // enqueues a follow-up turn on the SAME session (queue-based auto-resume).
  onBgComplete: (sid: string, info: BgCompleteInfo) => void;
  // Called when the bg specialist starts (optional UI/telemetry).
  onBgStarted?: (sid: string, info: { specialist?: string; taskId: string }) => void;
}

export class SessionQueryManager {
  private conns = new Map<string, SessionConn>();
  // Per-sid PushQueue for the active turn. The pump pushes non-task messages here;
  // runChiefAttempt's EXISTING for-await loop consumes it (the loop code does not
  // change at all — only the `stream` source becomes this queue). The result message
  // is pushed, the loop breaks; endTurn closes the queue.
  private activeTurns = new Map<string, PushQueue<unknown>>();

  constructor(private opts: SessionQueryManagerOpts) {}

  getConn(sid: string): SessionConn | undefined {
    const c = this.conns.get(sid);
    return c && c.alive ? c : undefined;
  }

  isAlive(sid: string): boolean {
    return !!this.getConn(sid);
  }

  /**
   * If the signature matches, return the existing live conn; otherwise close the old
   * one and create a new one. createQuery is the closure that opens query() with a
   * push-input iterable + abortController (all options are set up in runChiefAttempt).
   */
  acquireConn(
    sid: string,
    signature: string,
    createQuery: (input: AsyncIterable<SDKUserMessage>, abort: AbortController) => Query,
  ): SessionConn {
    const existing = this.conns.get(sid);
    if (existing && existing.alive && existing.signature === signature) {
      return existing;
    }
    if (existing) {
      this.closeConn(sid, existing.signature === signature ? "dead_recreate" : "signature_change");
    }
    const input = new PushQueue<SDKUserMessage>();
    const abortController = new AbortController();
    const query = createQuery(input, abortController);
    const conn: SessionConn = {
      sid,
      query,
      input,
      abortController,
      signature,
      alive: true,
      bgTasks: new Map(),
      bgToolUseIds: new Set(),
    };
    this.conns.set(sid, conn);
    void this.pump(conn);
    this.opts.logger.info("persistent_conn_create", { sid });
    return conn;
  }

  // At the start of a turn: create + store + return the PushQueue holding this turn's
  // message stream. runChiefAttempt consumes it as `stream` via for-await. If an old
  // (unclosed) queue exists, close it first.
  beginTurnStream(sid: string): AsyncIterable<unknown> {
    const old = this.activeTurns.get(sid);
    if (old) old.end();
    const q = new PushQueue<unknown>();
    this.activeTurns.set(sid, q);
    return q;
  }

  endTurn(sid: string): void {
    const q = this.activeTurns.get(sid);
    this.activeTurns.delete(sid);
    if (q) {
      try {
        q.end();
      } catch {
        /* ignore */
      }
    }
  }

  pushInput(sid: string, msg: SDKUserMessage): void {
    const conn = this.conns.get(sid);
    if (conn && conn.alive) {
      conn.input.push(msg);
      this.opts.logger.info("persistent_push_input", { sid });
    } else {
      this.opts.logger.warn("persistent_push_input_no_conn", { sid, alive: conn?.alive });
    }
  }

  // Called when an Agent(background:true) is seen during a turn — mark the bg tool_use
  // (task_notification triggers resume only for these).
  markBackground(sid: string, toolUseId: string, specialist?: string): void {
    const conn = this.conns.get(sid);
    if (!conn) return;
    conn.bgToolUseIds.add(toolUseId);
    if (specialist) {
      // Store the tool_use_id -> specialist mapping before task_started arrives;
      // when task_started comes we merge it with task_id.
      conn.bgTasks.set(`tu:${toolUseId}`, { specialist, toolUseId });
    }
  }

  closeConn(sid: string, reason: string): void {
    const conn = this.conns.get(sid);
    if (!conn) return;
    conn.alive = false;
    this.conns.delete(sid);
    const t = this.activeTurns.get(sid);
    if (t) {
      try {
        t.end();
      } catch {
        /* ignore */
      }
    }
    try {
      conn.input.end();
    } catch {
      /* yoksay */
    }
    try {
      conn.query.interrupt?.().catch(() => {});
    } catch {
      /* yoksay */
    }
    try {
      conn.query.close?.();
    } catch {
      /* yoksay */
    }
    this.opts.logger.info("persistent_conn_close", { sid, reason });
  }

  closeAll(reason: string): void {
    for (const sid of [...this.conns.keys()]) this.closeConn(sid, reason);
  }

  // ----- internal mechanics -----

  private async pump(conn: SessionConn): Promise<void> {
    try {
      for await (const msg of conn.query) {
        if (!conn.alive) break;
        // Diagnostic log (Fix 138 hang diagnosis): which messages the pump receives +
        // whether there is an active turn when the result arrives. In the B test it
        // shows exactly where it got stuck. ~dozen lines in a single-turn test, acceptable.
        const mm = msg as { type?: string; subtype?: string };
        this.opts.logger.info("persistent_pump_msg", {
          sid: conn.sid,
          type: mm.type,
          subtype: mm.subtype,
          hasTurn: this.activeTurns.has(conn.sid),
        });
        this.route(conn, msg);
      }
    } catch (e) {
      this.opts.logger.warn("persistent_pump_error", {
        sid: conn.sid,
        err: (e as Error).message,
      });
    } finally {
      conn.alive = false;
      this.conns.delete(conn.sid);
      const t = this.activeTurns.get(conn.sid);
      if (t) {
        // If the conn died mid-turn, terminate the for-await loop (gotResult=false
        // -> runChiefAttempt handles the empty-turn fallback).
        try {
          t.end();
        } catch {
          /* ignore */
        }
      }
      this.opts.logger.info("persistent_pump_closed", { sid: conn.sid });
    }
  }

  private route(conn: SessionConn, msg: unknown): void {
    const m = msg as { type?: string; subtype?: string };
    if (
      m.type === "system" &&
      (m.subtype === "task_started" ||
        m.subtype === "task_notification" ||
        m.subtype === "task_progress")
    ) {
      this.handleTaskMsg(conn, msg);
      return;
    }
    const turn = this.activeTurns.get(conn.sid);
    if (turn) turn.push(msg);
    // No active turn + non-task message -> idle leftover, ignore.
  }

  private handleTaskMsg(conn: SessionConn, msg: unknown): void {
    const m = msg as {
      subtype?: string;
      task_id?: string;
      tool_use_id?: string;
      subagent_type?: string;
      status?: string;
      summary?: string;
      output_file?: string;
    };
    const taskId = m.task_id ?? "";
    if (m.subtype === "task_started") {
      // Carry over the specialist stored earlier in markBackground via tool_use_id.
      const pre = m.tool_use_id ? conn.bgTasks.get(`tu:${m.tool_use_id}`) : undefined;
      conn.bgTasks.set(taskId, {
        specialist: m.subagent_type ?? pre?.specialist,
        toolUseId: m.tool_use_id,
      });
      if (m.tool_use_id) conn.bgTasks.delete(`tu:${m.tool_use_id}`);
      if (m.tool_use_id && conn.bgToolUseIds.has(m.tool_use_id)) {
        this.opts.onBgStarted?.(conn.sid, {
          specialist: m.subagent_type ?? pre?.specialist,
          taskId,
        });
      }
      return;
    }
    if (m.subtype === "task_notification") {
      const info = conn.bgTasks.get(taskId);
      conn.bgTasks.delete(taskId);
      // Only REAL background tasks trigger resume. A foreground subagent's
      // notification already returned to the model within the turn (resume
      // unnecessary, would cause double execution).
      const isBg = info?.toolUseId ? conn.bgToolUseIds.has(info.toolUseId) : false;
      if (info?.toolUseId) conn.bgToolUseIds.delete(info.toolUseId);
      if (!isBg) return;
      this.opts.onBgComplete(conn.sid, {
        specialist: info?.specialist,
        summary: m.summary ?? "",
        outputFile: m.output_file ?? "",
        status: (m.status as BgCompleteInfo["status"]) ?? "completed",
      });
      return;
    }
    // task_progress: ignored in the first version (live UI progress is Phase-2).
  }
}

export function createSessionQueryManager(
  opts: SessionQueryManagerOpts,
): SessionQueryManager {
  return new SessionQueryManager(opts);
}
