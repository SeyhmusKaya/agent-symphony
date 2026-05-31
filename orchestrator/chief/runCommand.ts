// runCommand — turn dispatch for a Command (a user/autonomous message coming
// through the queue). Parses slash syntax (/compact, /clear, /reflect and
// custom-slash), runs the runChiefAttempt retry loop, applies the pause/stop
// flow, writes M1/M2 fail/resume notes, and fires the final trigger via half-plan
// auto-continue injection + maybeAutoCompact.
//
// F9: further main.ts splitting — factory pattern.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Attachment, ArchitectServer, ToolActivity, ChatSegment } from "../server.js";
import type { Command, CommandQueue } from "../queue.js";
import type { SessionStore, SessionChatEntry } from "../sessionStore.js";
import type { Logger } from "../logger.js";
import { parseSlash } from "../slash.js";
import type { RunnerState, PauseTracker, CostTracker } from "../state.js";
import type { AutonomousManager } from "../autonomousMode.js";
import { sleep, extractNarrative } from "../chiefUtils.js";
import type { RunChiefAttemptFn } from "./runChiefAttempt.js";
import type { AutoCompactApi } from "./autoCompact.js";

export interface RunCommandDeps {
  isGlobal: boolean;
  paths: { commands: string };
  globalReportDir: string;
  attachMap: Map<string, Attachment[]>;
  // C1: 5 → 2. On ConnectionRefused/restart the old setup did 5*1.5s = 7-15s of
  // UI thinking, an expensive wait repeated every time on autonomous failures.
  // 2 attempts is enough; the first attempt already catches most transients.
  maxAttempt?: number;

  // Shared instances
  chief: SessionStore;
  queue: CommandQueue;
  server: ArchitectServer;
  logger: Logger;
  state: RunnerState;
  pauseTracker: PauseTracker;
  costTracker: CostTracker;
  autonomousManager: AutonomousManager;

  // Inner-fn factories
  runChiefAttempt: RunChiefAttemptFn;
  runCompact: AutoCompactApi["runCompact"];
  maybeAutoCompact: AutoCompactApi["maybeAutoCompact"];

  // Emit + helpers
  emit: (type: string, payload: Record<string, unknown>) => void;
  pushStatus: () => void;
  syncSessionState: () => void;
  setLastContextIfActive: (sid: string, ctx: number) => void;
  // F1.3b: bgTasks resetChain no-op. Module-level autoDevamCount is in state.

  // Half-plan injection counter limit.
  maxAutoDevam?: number;
}

const DEFAULT_MAX_ATTEMPT = 2;
const DEFAULT_MAX_AUTO_DEVAM = 2;

export function createRunCommand(deps: RunCommandDeps): (cmd: Command) => Promise<void> {
  const {
    isGlobal,
    paths,
    globalReportDir,
    attachMap,
    chief,
    queue,
    server,
    logger,
    state,
    pauseTracker,
    autonomousManager,
    runChiefAttempt,
    runCompact,
    maybeAutoCompact,
    emit,
    pushStatus,
    syncSessionState,
    setLastContextIfActive,
  } = deps;
  const MAX_ATTEMPT = deps.maxAttempt ?? DEFAULT_MAX_ATTEMPT;
  const MAX_AUTO_DEVAM = deps.maxAutoDevam ?? DEFAULT_MAX_AUTO_DEVAM;

  return async function runCommand(cmd: Command): Promise<void> {
    // P1.33: parallel sessions — sid is locally bound, chief.activate() is NO LONGER
    // CALLED. activate used to change the UI's active tab; the runner does not touch
    // it. All chief.* writes are sid-targeted (*For variants).
    const sid = cmd.sessionId ?? chief.getActiveId();
    const slash = parseSlash(cmd.text, paths.commands);
    if (slash.kind === "builtin" && slash.name === "compact") {
      await runCompact(cmd);
      return;
    }
    // /reflect — reflection ON for the next turn. One-shot flag.
    if (slash.kind === "builtin" && slash.name === "reflect") {
      state.reflectOnNextTurn = true;
      emit("sef_cevap", {
        id: cmd.id,
        reply: "Reflection enabled for the next turn. Type a command; after your turn a critique will be added.",
        cost: { in: 0, out: 0 },
        autonomous: false,
      });
      server.sendTurBitti(cmd.id, false, false, sid);
      server.sendChiefIdle(cmd.id, false, sid);
      server.sendTamamenIdle(cmd.id, false, sid);
      return;
    }
    // M3: Silent cache-cold compact DISABLED. Per user request: an unconfirmed
    // compact should only trigger for (a) manual /compact or (b) real danger (>95%).
    // The cache-cold "efficiency" trigger was removed because it was deemed
    // unclear/semi-automatic. Only the pausedDurationMs reset remains:
    if (!cmd.autonomous) pauseTracker.pausedDurationMs = 0;
    const prompt = slash.kind === "custom" ? `${slash.body}\n\n${slash.args}` : cmd.text;
    const resetSession = slash.kind === "builtin" && slash.name === "clear";
    if (resetSession) {
      // /clear LOCAL — NO API call. Reset compact + context + chat, drop the SDK
      // session id, send a confirmation message to the user, return. The old
      // behavior sent prompt="/clear" to the chief and the API returned
      // "[Turn failed: error_during_execution]".
      chief.setCompactFor(sid, "");
      chief.setContextFor(sid, 0);
      // P1.3: skip memSys on the first turn too — set up a pristine cache prefix.
      state.skipMemSysOnNextTurn = true;
      chief.clearSessionIdFor(sid, "user_clear");
      const chatRef = chief.getChatFor(sid);
      chatRef.length = 0;
      chief.saveChatFor(sid);
      chief.pushChatFor(sid, {
        role: "sef",
        text: "Session reset. Let's start fresh with your new message.",
        ts: Date.now(),
      });
      // If we are on the active tab, resync module-level views — so the UI getStatus
      // does not show stale cache.
      if (sid === chief.getActiveId()) syncSessionState();
      pushStatus();
      server.sendTurBasladi(cmd.id, false, sid);
      emit("sef_cevap", {
        id: cmd.id,
        reply: "Session reset.",
        cost: { in: 0, out: 0 },
        autonomous: false,
      });
      // Bug fix: emit("sef_idle") is only the in-process event bus — it does not reach
      // the UI, Thinking stays stuck forever. The server.send* methods WS-broadcast.
      server.sendTurBitti(cmd.id, false, false, sid);
      server.sendChiefIdle(cmd.id, false, sid);
      server.sendTamamenIdle(cmd.id, false, sid);
      logger.info("clear_yapildi", { id: cmd.id });
      return;
    }
    const ekler = attachMap.get(cmd.id);
    attachMap.delete(cmd.id);

    logger.info("komut_alindi", {
      id: cmd.id,
      metinUzunluk: cmd.text.length,
      slash: slash.kind,
      ekSayisi: ekler?.length ?? 0,
    });

    // "New turn started" signal to the UI — so when there are multiple commands in
    // the queue there is no running=false flicker in between, and the Thinking
    // indicator appears instantly. The autonomous flag is carried so the UI can open
    // background-busy mode.
    const isAuto = !!cmd.autonomous;
    server.sendTurBasladi(cmd.id, isAuto, sid);

    const userImages = (ekler ?? [])
      .filter((e) => e.tur === "resim")
      .map((r) => `data:${r.mediaType ?? "image/png"};base64,${r.veri}`);
    // Fix 64b: onCommand enqueue already pushed the user msg (queued:true). Here
    // find that same entry (commandId match), set queued=false + add images.
    // If not found, push a new entry (autonomous turn or the enqueue path was skipped).
    const existingChat = chief.getChatFor(sid);
    const existingIdx = existingChat.findIndex(
      (e) => (e as SessionChatEntry & { commandId?: string }).commandId === cmd.id,
    );
    if (existingIdx >= 0) {
      const entry = existingChat[existingIdx] as SessionChatEntry & { commandId?: string; queued?: boolean };
      entry.queued = false;
      if (userImages.length) entry.images = userImages;
      // Reflect into chief.json. saveChatFor(sid): the entry was changed in the target
      // session (sid); saveChat() would write the active session (if sid != active,
      // wrong save, the image update would be lost). Images were already persisted at
      // enqueue (commandHandler) — this re-save is idempotent + writes queued=false.
      chief.saveChatFor(sid);
    } else {
      chief.pushChatFor(sid, {
        role: cmd.agentCall ? "ajan_komut" : isAuto ? "otonom" : "kullanici",
        text: cmd.text,
        ts: Date.now(),
        images: userImages.length ? userImages : undefined,
        fromAgent: cmd.fromAgent,
        commandId: cmd.id,
        queued: false,
      } as SessionChatEntry & { commandId?: string; queued?: boolean });
    }
    if (sid === chief.getActiveId()) syncSessionState();
    pushStatus();

    let reply = "";
    let aktivite: ToolActivity[] = [];
    let segments: ChatSegment[] = [];
    let cost: {
      in: number;
      out: number;
      cacheRead?: number;
      cacheCreate1h?: number;
      cacheCreate5m?: number;
      uncached?: number;
      usd?: number;
      model?: string;
    } = { in: 0, out: 0 };
    let images: string[] = [];
    let forceReset: boolean = resetSession;
    let lastTransient = false;
    let lastPlanYarim = false;
    let lastOrphans: string[] = [];
    // M1/M2: accumulated fail/resume notes — written to the chatLog as a system
    // message after the whole turn ends. If there are multiple retries, all are listed.
    const failNotlari: string[] = [];
    const resumeNotlari: string[] = [];
    let lastAutonomousFail = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPT; attempt++) {
      if (pauseTracker.isPausedFor(sid)) break;
      // F7: if stop was triggered by the user, do not retry — exit.
      if (pauseTracker.isStoppedFor(sid)) break;
      server.sendChiefPartial(cmd.id, "", true, isAuto, sid);
      const r = await runChiefAttempt(
        sid,
        prompt,
        forceReset,
        (d) => server.sendChiefPartial(cmd.id, d, false, isAuto, sid),
        ekler,
        (id, ad, durum) => server.sendAktivite(cmd.id, id, ad, durum, isAuto, sid),
        (lin, lout, ctx, extra) => {
          // Do not emit a token event during pause — the UI counters drop to 0/0 and
          // show a "Thinking 0/0" ghost. Emit only while active.
          if (pauseTracker.isPausedFor(sid)) return;
          chief.setContextFor(sid, ctx);
          setLastContextIfActive(sid, ctx);
          server.sendChiefToken(cmd.id, lin, lout, ctx, isAuto, {
            liveCacheRead: extra?.cacheRead,
            liveCacheCreate1h: extra?.cacheCreate,
            liveUncached: extra?.uncached,
            liveUsd: extra?.usd,
            sessionUsd: deps.costTracker.sessionUsd + (extra?.usd ?? 0),
            model: extra?.model,
            sessionId: sid,
          });
        },
        cmd.agentCall, // if cross-agent call, ask_user_choice is disabled
        // Fix 62: per-tool token UI update.
        (id, tokens) => server.sendAktiviteTokens(cmd.id, id, tokens, sid),
        // Fix 93: tool input/result mid-stream to the UI.
        (id, ioKind, text, hata) => server.sendAktiviteIO(cmd.id, id, ioKind, text, !!hata, sid),
      );
      reply = r.reply;
      aktivite = r.aktivite;
      segments = r.segments;
      cost = r.cost;
      images = r.images;
      lastTransient = r.transient;
      lastPlanYarim = r.planYarim;
      lastOrphans = r.orphanedTools;
      if (r.autonomousFail) lastAutonomousFail = true;
      if (r.autonomousFail) {
        failNotlari.push(
          `[Turn failed: error_during_execution] (attempt ${attempt}/${MAX_ATTEMPT})`,
        );
      }
      if (r.resumeLostReason) {
        resumeNotlari.push(
          `[New chief session opened — the previous session was lost, reason: ${r.resumeLostReason}]`,
        );
      }
      logger.info("deneme_sonuc", {
        id: cmd.id,
        attempt,
        transient: r.transient,
        autonomousFail: r.autonomousFail,
        resumeLostReason: r.resumeLostReason,
        replyUzunluk: reply.length,
      });
      if (pauseTracker.isPausedFor(sid)) break;
      // F7: no retry after stop.
      if (pauseTracker.isStoppedFor(sid)) break;
      if (!r.transient || attempt === MAX_ATTEMPT) break;
      // Fix 151 (USER DIRECTIVE): on a transient error (network/429/500) do NOT change
      // the session — retry in the SAME session. The old code opened a fresh session
      // via clearSessionIdFor + forceReset, which caused context loss. clearSessionIdFor
      // is already a no-op now (except user_clear); we also REMOVED forceReset so resume
      // continues the same conversation. If the SDK truly rejects the resume (400
      // dangling / No conversation) it returns a new session_id ITSELF — that is
      // SDK-mandated, recorded via setSessionIdFor.
      // (forceReset = true REMOVED — see above.)
      emit("hata", {
        agent: "sef",
        mesaj: `Transient API error, retrying (${attempt}/${MAX_ATTEMPT})…`,
      });
      // C1: 1500 → 500 ms. After a restart the proxy comes up in 200-400ms;
      // this much wait is enough, the user barely notices.
      await sleep(500 * attempt);
    }
    // F7: stop — the current turn was cut, the queue is NOT paused. Drop the streamed
    // part into the chat (so the user does not feel loss), mark the command as
    // "kesildi" (cut), and move to the next pending message (the queue.processOne loop
    // picks up the next pending cmd immediately in the same runner).
    if (pauseTracker.isStoppedFor(sid)) {
      const streamedTextRaw = segments
        .map((s) => (s.kind === "text" ? s.text : ""))
        .join("");
      const diagnosticRegex = /^\[ede_diagnostic\][^\n]*\n?|^Chief run stopped with error:[\s\S]*$|^\[Turn failed:[^\]]+\]\s*$/i;
      const streamedText = streamedTextRaw.replace(diagnosticRegex, "").trim();
      const hasMeaningfulContent = streamedText.length > 0 || aktivite.length > 0;
      if (hasMeaningfulContent) {
        chief.pushChatFor(sid, {
          role: "sef",
          text: streamedText,
          ts: Date.now(),
          aktivite,
          segments: streamedText ? segments : [],
          cost,
          images: images.length ? images : undefined,
        });
      }
      // Is there a next pending message? Vary the note accordingly.
      const hasMoreInQueue = queue.list().some(
        (c) => c.status === "bekliyor" && c.sessionId === sid,
      );
      const note = hasMoreInQueue
        ? "[Turn stopped — moving to the next message in the queue]"
        : "[Turn stopped]";
      chief.pushChatFor(sid, { role: "sef", text: note, ts: Date.now() });
      // Clear the flag — so the next runCommand starts clean.
      pauseTracker.removeStopped(sid);
      // Mark the command as cut. queue.processOne no longer overwrites statuses
      // other than "isleniyor" (F7 queue patch).
      cmd.status = "kesildi";
      if (sid === chief.getActiveId()) syncSessionState();
      server.sendTurBitti(cmd.id, false, false, sid);
      server.sendChiefIdle(cmd.id, false, sid);
      // Do not emit the fully-idle signal if the next cmd will be picked up; the
      // queue.processOne loop continues automatically and opens a new runCommand.
      if (!hasMoreInQueue) {
        server.sendTamamenIdle(cmd.id, false, sid);
      }
      pushStatus();
      return;
    }
    // If paused: KEEP the sessionId (the user does not want to lose memory). If there
    // is a dangling tool_use risk after SDK interrupt(), the next resume returns SDK
    // 400 and the transient retry path already calls clearSessionId. So continuing
    // after pause usually proceeds while preserving memory; if corrupted, an automatic
    // one-shot reset.
    if (pauseTracker.isPausedFor(sid)) {
      // P1.33 fix: the text/segments the chief streamed before interrupt must be
      // preserved. Old behavior: sendChiefReply(cmd.id, note) — the UI overwrote the
      // streaming entry with the note on commandId match, "everything it wrote was
      // erased". New: finalize the streaming entry + a separate note. We do NOT send
      // sef_cevap; sef_tur_bitti stops the UI Thinking, status push syncs the chat.
      const streamedTextRaw = segments
        .map((s) => (s.kind === "text" ? s.text : ""))
        .join("");
      // P1.33: do not show on the user screen the Claude Code SDK internal diagnostics
      // (ede_diagnostic) or interrupt messages like "Chief run stopped with error: ..."
      // — during pause it means the chief produced no text.
      const diagnosticRegex = /^\[ede_diagnostic\][^\n]*\n?|^Chief run stopped with error:[\s\S]*$|^\[Turn failed:[^\]]+\]\s*$/i;
      const streamedText = streamedTextRaw.replace(diagnosticRegex, "").trim();
      const replyClean = (reply || "").trim().match(diagnosticRegex) ? "" : (reply || "").trim();
      const finalText = (replyClean && !lastTransient) ? replyClean : streamedText;
      // Save only if there is meaningful content or tool activity. If the chief did
      // nothing (only the note is shown) do not push an empty chief entry.
      const hasMeaningfulContent = finalText.length > 0 || aktivite.length > 0;
      if (hasMeaningfulContent) {
        chief.pushChatFor(sid, {
          role: "sef",
          text: finalText,
          ts: Date.now(),
          aktivite,
          segments: finalText ? segments : [],
          cost,
          images: images.length ? images : undefined,
        });
      }
      // Fix 44: the "Paused" note is unnecessary if there IS a pending message in the
      // queue — the chief will continue automatically on the next turn. Print the note
      // only when there really is "no pending left". Otherwise the chat fills with
      // "Paused" spam.
      const hasMoreInQueue = queue.list().some(
        (c) => c.status === "bekliyor" && c.sessionId === sid,
      );
      if (!hasMoreInQueue) {
        const note = "[Paused]";
        chief.pushChatFor(sid, { role: "sef", text: note, ts: Date.now() });
      }
      // Fix STOP-5: pause is now DURABLE — the flag is NOT cleared. The old behavior
      // (removePaused) auto-cleared the pause at finalize → the next command in the
      // queue was processed immediately, the "pause is not durable, the queue keeps
      // itself going" bug. Now the sid stays PAUSED; only an explicit "resume"
      // (controlHandler) clears the flag and triggers queue.process.
      if (sid === chief.getActiveId()) syncSessionState();
      server.sendTurBitti(cmd.id, false, false, sid);
      server.sendChiefIdle(cmd.id, false, sid);
      server.sendTamamenIdle(cmd.id, false, sid);
      pushStatus();
      return;
    }
    // If the session is left corrupted, clear it for the next command.
    if (lastTransient) chief.clearSessionIdFor(sid, "transient_cleanup");
    // If all attempts are exhausted and a transient error persists, do not show the
    // user the raw "API Error: 400…" — give a clear message.
    if (lastTransient) {
      logger.error("komut_basarisiz", {
        id: cmd.id,
        hamHata: reply.slice(0, 1000),
      });
      reply =
        "A transient API connection error occurred and the attempts failed. " +
        "The session was reset — please send your message again.";
    }

    // M1/M2: write the accumulated fail/resume notes as a system "sef" message —
    // it comes before the real reply, so the user sees what went wrong.
    for (const note of [...resumeNotlari, ...failNotlari]) {
      chief.pushChatFor(sid, { role: "sef", text: note, ts: Date.now() });
    }
    chief.pushChatFor(sid, {
      role: "sef",
      text: reply,
      ts: Date.now(),
      aktivite,
      segments,
      cost,
      images: images.length ? images : undefined,
      narrative: extractNarrative(reply) || undefined,
    });
    if (sid === chief.getActiveId()) syncSessionState();
    // Send the system notes over WS too (since the UI chatLog refresh comes from the
    // status channel server.pushStatus already updates it, but broadcast directly too).
    for (const note of [...resumeNotlari, ...failNotlari]) {
      server.sendChiefReply(cmd.id, note, [], { in: 0, out: 0 }, [], [], isAuto, { sessionId: sid });
    }
    const narrative = extractNarrative(reply);
    server.sendChiefReply(
      cmd.id,
      reply,
      aktivite,
      cost,
      segments,
      images,
      isAuto,
      {
        autonomousFail: lastAutonomousFail || undefined,
        narrative: narrative || undefined,
        sessionId: sid,
      },
    );
    // P1.33: context was already written sid-bound via setContextFor (inside the token
    // callback). If this is the active tab, we refresh the module mirror via
    // syncSessionState.
    pushStatus();
    // Session length limit — auto-compact when context reaches 90%.
    // /compact and /clear already reset lastContext; this check only runs at the end
    // of a normal command. The autoCompactRunning flag prevents recursive triggering.
    await maybeAutoCompact(sid);
    // Half-plan detection — if the chief said "now I will do X" and closed the turn,
    // or there is an orphan tool, inject an automatic CONTINUE. Infinite-loop guard:
    // MAX_AUTO_DEVAM = 2 consecutive. The counter is reset on a real user turn.
    if (lastPlanYarim && !pauseTracker.isPausedFor(sid) && !lastTransient && state.autoDevamCount < MAX_AUTO_DEVAM) {
      state.autoDevamCount++;
      const orphanNote = lastOrphans.length
        ? `First, the uncompleted tools: ${lastOrphans.join(", ")}. `
        : "";
      queue.enqueue(
        `[AUTO CONTINUE ${state.autoDevamCount}/${MAX_AUTO_DEVAM}] ${orphanNote}` +
          "In your previous turn you left the plan half-finished — continue from where you left off and complete the task. " +
          "Do not ask the user anything, proceed directly.",
        { autonomous: true },
      );
      logger.info("auto_devam_enjekte", {
        sayac: state.autoDevamCount,
        orphans: lastOrphans.length,
      });
    } else if (!lastPlanYarim) {
      // Really finished — reset the counter (to move on to a new topic).
      state.autoDevamCount = 0;
    }
    // Write the night-scan reply to a separate report file — so it is reachable on
    // the Reports screen.
    if (isGlobal && cmd.isScan && reply.trim()) {
      try {
        if (!existsSync(globalReportDir)) mkdirSync(globalReportDir, { recursive: true });
        const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const dayKey = new Intl.DateTimeFormat("en-CA", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          timeZone: TZ,
        }).format(new Date());
        const path = join(globalReportDir, `scan-${dayKey}.md`);
        const md = [
          `# Night Scan — ${dayKey}`,
          ``,
          `Created: ${new Intl.DateTimeFormat("tr-TR", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit", hour12: false,
            timeZone: TZ,
          }).format(new Date())}`,
          ``,
          reply.trim(),
        ].join("\n");
        writeFileSync(path, md, "utf8");
        logger.info("scan_report_saved", { path });
      } catch (e) {
        logger.error("scan_report_save_err", { hata: (e as Error).message });
      }
    }
    // M3: Auto-compact after advisor DISABLED. The user does not want unconfirmed
    // compaction — even if the advisor reply bloats the context, let the chief decide
    // for itself (or /compact). The flag is reset only for tracking.
    if (state.advisorInteractionPending) {
      state.advisorInteractionPending = false;
    }
    // After this command finishes, emit an explicit "idle" signal — so the UI does not
    // get stuck on ghost Thinking. In queue.list() this cmd is still "isleniyor" (not
    // turned to done until the handler returns), so it is sent UNCONDITIONALLY. If
    // there is another pending cmd right after, queue.process triggers a new runCommand
    // and emits sef_tur_basladi, the UI restarts — flicker-free.
    server.sendChiefIdle(cmd.id, isAuto, sid);
    // Single turn-done signal — the UI may turn off the "Thinking" indicator but does
    // NOT fire a notification.
    server.sendTurBitti(cmd.id, isAuto, lastPlanYarim, sid);
    // Fix 97: instant runningSessions update. The SendTurBitti event clears the UI's
    // streamIdx + canliAktivite BUT the `running` flag is still TRUE (runningSessions
    // comes from backend status). The existing pushStatus is periodic; 5-10s of UI
    // "Thinking" stuck after sef_cevap. Send runningSessions=[] via an instant
    // pushStatus → the UI running flag drops immediately.
    pushStatus();
    // The real "work done, can notify the user" signal:
    //   - no pending command in the queue (including autonomous follow-up)
    //   - autoDevamCount is zero (we are not expecting a half-plan injection)
    //   - autoCompactRunning is false
    // F1.3b: bgTasks running check removed (no BgTaskManager).
    // If any of these is true, sef_tamamen_idle is NOT emitted; it is checked again at
    // the end of the next runCommand.
    const pendingLeft = queue.pending().length;
    const devamBekliyor = lastPlanYarim && state.autoDevamCount > 0 && state.autoDevamCount <= MAX_AUTO_DEVAM;
    if (pendingLeft === 0 && !devamBekliyor && !state.autoCompactRunning) {
      server.sendTamamenIdle(cmd.id, lastAutonomousFail, sid);
      logger.info("tamamen_idle", {
        commandId: cmd.id,
        autonomousFail: lastAutonomousFail,
      });
    }
    // F3 (autonomous 3-day mode): if this turn is part of an autonomous job, fire the
    // checkpoint/failure callback. lastAutonomousFail means "consecutive fail"; on
    // success the checkpoint counters are updated + auto-commit is checked. Idempotent
    // — via try/catch, if autonomousManager is absent or the job is not found it is
    // silently dropped.
    if (cmd.autonomousJobId) {
      try {
        if (lastAutonomousFail) {
          await autonomousManager.onTurnFailure(
            cmd.autonomousJobId,
            failNotlari[failNotlari.length - 1] ?? "unknown error",
          );
        } else {
          await autonomousManager.onTurnCheckpoint(
            cmd.autonomousJobId,
            cost?.usd ?? 0,
          );
        }
      } catch (e) {
        logger.warn("autonomous_callback_hata", {
          jobId: cmd.autonomousJobId,
          hata: (e as Error).message,
        });
      }
    }
  };
}
