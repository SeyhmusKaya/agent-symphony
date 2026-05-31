import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type CommandStatus =
  | "bekliyor"
  | "isleniyor"
  | "tamamlandi"
  | "hata"
  | "kesildi";

export interface Command {
  id: string;
  text: string;
  status: CommandStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  // Autonomous turn — injected by the backend when a background task
  // completes. The UI shows a different style; aware from the Architect prompt.
  autonomous?: boolean;
  // Cross-agent call — came from another agent via talk_to_chief /
  // sendCommandAwait. The ask_user_choice tool is disabled in this turn
  // (otherwise the caller agent deadlocks — chief asks the UI, no user present).
  agentCall?: boolean;
  // Caller agent name (badge "Marketing Specialist asked" in the UI).
  fromAgent?: string;
  // Nightly scan command — this flag is used instead of string comparison.
  isScan?: boolean;
  // P1.32: parallel sessions — which session does the command belong to? The
  // active session id is written at enqueue; the processor runs concurrently per sessionId.
  sessionId?: string;
  // F3 (autonomous 3-day mode): a turn linked to an autonomous job. The
  // AutonomousManager calls checkpoint/failure callbacks with this id. The jobId
  // is not carried without autonomous=true.
  autonomousJobId?: string;
}

export type CommandHandler = (cmd: Command) => Promise<void>;

// N2: save debounce — process() should not write to disk on every turn during
// rapid status changes. Batch within a 500ms window.
const SAVE_DEBOUNCE_MS = 500;

export class CommandQueue {
  private commands: Command[] = [];
  private running = false;
  private filePath: string | null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? null;
    this.load();
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    const raw = readFileSync(this.filePath, "utf8").trim();
    if (raw) { try { this.commands = JSON.parse(raw) as Command[]; } catch { this.commands = []; } }
  }

  // Synchronous disk write — for flushSync (shutdown).
  private saveNow(): void {
    if (!this.filePath) return;
    // Limit completed commands to 100 — prevent unbounded growth
    const active = this.commands.filter((c) => c.status === "bekliyor" || c.status === "isleniyor");
    const done = this.commands.filter((c) => c.status !== "bekliyor" && c.status !== "isleniyor");
    if (done.length > 100) this.commands = [...active, ...done.slice(-100)];
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.commands, null, 2), "utf8");
  }

  // N2: debounced save. Trailing edge — the last call is written 500ms later.
  private save(): void {
    if (!this.filePath) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  // Graceful shutdown: cancel the pending debounce + flush the latest state to disk.
  flushSync(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveNow();
  }

  enqueue(text: string, opts?: { autonomous?: boolean; agentCall?: boolean; fromAgent?: string; isScan?: boolean; sessionId?: string; autonomousJobId?: string }): Command {
    const cmd: Command = {
      id: randomUUID(),
      text,
      status: "bekliyor",
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      error: null,
      autonomous: opts?.autonomous ?? false,
      agentCall: opts?.agentCall ?? false,
      fromAgent: opts?.fromAgent,
      isScan: opts?.isScan ?? false,
      sessionId: opts?.sessionId,
      autonomousJobId: opts?.autonomousJobId,
    };
    this.commands.push(cmd);
    this.save();
    return cmd;
  }

  list(): Command[] {
    return [...this.commands];
  }

  pending(): Command[] {
    return this.commands.filter((c) => c.status === "bekliyor");
  }

  recover(): Command[] {
    // Commands left over from the previous process at boot:
    //  - "isleniyor": a half-finished turn, always cancel.
    //  - "bekliyor" (non-autonomous): a ghost job in the queue that never started.
    //    The user did not request it again in the new session → it should not
    //    show as QUEUED/run silently. Autonomous jobs are managed separately
    //    (autonomousManager), so do not touch them.
    const interrupted = this.commands.filter(
      (c) => c.status === "isleniyor" || (c.status === "bekliyor" && !c.autonomous),
    );
    for (const c of interrupted) {
      c.status = "kesildi";
      c.finishedAt = Date.now();
    }
    // saveNow: boot one-shot — write to disk instantly without waiting for the
    // debounce. Otherwise if it crashes again within 500ms the "kesildi" status
    // is lost and the ghost returns.
    if (interrupted.length) this.saveNow();
    return interrupted;
  }

  // P1.32: per-session parallel processor. A single runner per same sessionId;
  // different sessionIds run concurrently. The old single-runner behavior is
  // still sequential in environments without a sessionId (old caller).
  // Fix 44: the paused callback is now (sid) => boolean — per-session pause.
  // The old () => boolean signature is also supported (sid is ignored, global block).
  private runningSessions = new Set<string>();
  async process(
    handler: CommandHandler,
    paused?: ((sid: string) => boolean) | (() => boolean),
  ): Promise<void> {
    // Group pending commands by sessionId; spawn a single runner per sessionId.
    // If there are multiple sessionIds they all start concurrently.
    const pendingBySession = new Map<string, Command[]>();
    for (const c of this.commands) {
      if (c.status !== "bekliyor") continue;
      const sid = c.sessionId ?? "__noid__";
      const arr = pendingBySession.get(sid) ?? [];
      arr.push(c);
      pendingBySession.set(sid, arr);
    }
    const tasks: Promise<void>[] = [];
    for (const sid of pendingBySession.keys()) {
      if (this.runningSessions.has(sid)) continue;
      // Fix 44: do not spawn the queue for a paused sid — other sids are unaffected.
      if (paused && (paused as (s: string) => boolean)(sid)) continue;
      this.runningSessions.add(sid);
      tasks.push(this.processOne(sid, handler, paused));
    }
    await Promise.all(tasks);
  }
  private async processOne(
    sid: string,
    handler: CommandHandler,
    paused?: ((sid: string) => boolean) | (() => boolean),
  ): Promise<void> {
    try {
      while (true) {
        // Fix 44: per-session pause check.
        if (paused && (paused as (s: string) => boolean)(sid)) break;
        const cmd = this.commands.find((c) => {
          if (c.status !== "bekliyor") return false;
          const csid = c.sessionId ?? "__noid__";
          return csid === sid;
        });
        if (!cmd) break;
        cmd.status = "isleniyor";
        cmd.startedAt = Date.now();
        this.save();
        try {
          await handler(cmd);
          // F7: if the handler set its own status to "kesildi" (stop flow) or
          // moved it to another terminal status, do not overwrite. The only
          // default completion path runs while cmd is still "isleniyor".
          if (cmd.status === "isleniyor") cmd.status = "tamamlandi";
        } catch (e) {
          cmd.status = "hata";
          cmd.error = (e as Error).message;
        }
        cmd.finishedAt = Date.now();
        this.save();
      }
    } finally {
      this.runningSessions.delete(sid);
    }
  }
}
