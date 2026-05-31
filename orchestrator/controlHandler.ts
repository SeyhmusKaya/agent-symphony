// onControl WS handler — duraklat / durdur / devam / plan_ac / plan_kapat.
// F9 extra split. Pause/stop semantics are maintained via PauseTracker.

import type { SessionStore } from "./sessionStore.js";
import type { Logger } from "./logger.js";
import type { CommandQueue, Command } from "./queue.js";
import type { PauseTracker, RunnerState } from "./state.js";

export interface ControlHandlerDeps {
  chief: SessionStore;
  queue: CommandQueue;
  logger: Logger;
  pauseTracker: PauseTracker;
  state: RunnerState;
  emit: (type: string, payload: Record<string, unknown>) => void;
  buildRecentTurnsFragment: (sid: string, turnCount: number) => string;
  dispatchRunCommand: (cmd: Command) => Promise<void>;
}

export function createControlHandler(deps: ControlHandlerDeps) {
  const {
    chief,
    queue,
    logger,
    pauseTracker,
    state,
    emit,
    buildRecentTurnsFragment,
    dispatchRunCommand,
  } = deps;
  const isPausedFor = (sid: string): boolean => pauseTracker.isPausedFor(sid);

  // Fix STOP-1: if the control message carries a sessionId, target ONLY it;
  // otherwise target ALL sessions that are ACTUALLY running. The old behavior
  // only targeted chief.getActiveId() (the UI active tab) — if the running
  // session was different, getActiveQuery(activeId) returned undefined and the
  // real flow was never interrupted ("stop does not stop"). Falls back to the
  // active id if none is running (so pause/rebuild flags can be written while idle).
  const resolveTargets = (sessionId?: string): string[] => {
    if (sessionId) return [sessionId];
    const running = pauseTracker.runningSessionIds();
    return running.length ? running : [chief.getActiveId()];
  };

  // Fix STOP-1 + STOP-2: graceful interrupt() + hard abort() ile hedef
  // session'in query'sini garanti kes.
  const killSession = (sid: string): boolean => {
    const q = pauseTracker.getActiveQuery(sid);
    if (!q) return false;
    q.interrupt().catch(() => {});
    pauseTracker.abortFor(sid);
    return true;
  };

  return function onControl(
    aksiyon: "duraklat" | "durdur" | "devam" | "plan_ac" | "plan_kapat",
    sessionId?: string,
  ): void {
    if (aksiyon === "duraklat") {
      // Fix STOP-1: target session(s). Interrupt running queries, write only a
      // flag for idle ones.
      const targets = resolveTargets(sessionId);
      let anyRunning = false;
      for (const targetSid of targets) {
        // Fix 44: per-session pause. The pause branch triggers only in the
        // target session's runCommand; other sessions are unaffected (parallel
        // running). Fix STOP-5: pause is now DURABLE — it stays until devam.
        pauseTracker.addPaused(targetSid);
        const killed = killSession(targetSid);
        if (killed) {
          anyRunning = true;
          // Fix 120: the OLD behavior called clearSessionIdFor here. BUT
          // interrupt()/abort() is async + best-effort — if the sessionId is
          // deleted while the old stream is still draining, the NEXT message
          // reads a null resume id and opens a FRESH parallel SDK session for the
          // SAME logical session ("one session in two places"). The durdur path
          // already does NOT DELETE the id (see Fix STOP-4). duraklat should
          // preserve it too now → devam resumes the SAME conversation. Dangling
          // tool_use risk: if the SDK returns 400 on the next resume, runCommand's
          // transient_retry path does a one-time clearSessionId (an existing safety net).
          // chief.clearSessionIdFor(targetSid, "user_pause_interrupt"); // DISABLED
        }
        // Fix 95 + Fix 94: after pause/rebuild a new SDK session opens, the old
        // conversation is unreachable. Guarantee the agent remembers the old chat
        // by prepending a summary + last turn fragment to the next user message.
        // Write the flag for BOTH active AND idle chiefs — rebuild_ui sends
        // duraklat to idle chiefs too. (duraklat benefits from resume context;
        // durdur conversely does not prepend — see below.)
        const lastTurnsFragment = buildRecentTurnsFragment(targetSid, 3);
        chief.setNeedsContextPrependFor(targetSid, lastTurnsFragment);
      }
      if (anyRunning) pauseTracker.pauseStartedAt = Date.now();
      else {
        logger.info("pause_idle_chief_prepare_for_rebuild", {
          targets,
          runningSessions: pauseTracker.runningSessionIds(),
        });
      }
      emit("ajan_durum_degisti", { agent: "sef", durum: "duraklatildi" });
    } else if (aksiyon === "durdur") {
      // F7: durdur = interrupt the current turn; the queue is NOT paused. The
      // next pending message is processed immediately.
      const targets = resolveTargets(sessionId);
      for (const targetSid of targets) {
        pauseTracker.addStopped(targetSid);
        killSession(targetSid);
        // Fix STOP-4: durdur does NOT DELETE the SDK session id + does NOT WRITE
        // needsContextPrepend. So the next command resumes the SAME conversation,
        // not re-injecting context from scratch and "regenerating from the start".
        // (If there is a dangling tool_use risk, the SDK returns 400 on the next
        // resume → runCommand's transient_retry path does a one-time clearSessionId then.)
        // Pause flag synchronization: stop exits the old pause state.
        pauseTracker.removePaused(targetSid);
        // Fix STOP-6 (turn-repeat bug): if the user pauses FIRST and stops AFTER,
        // pause will have written the INTERRUPTED turn's fragment (a half "First I
        // do X" + tool) into needsContextPrepend. stop = ABANDON the turn; clear
        // this fragment. Otherwise on the next user message the model REDOES the
        // half work (same text + same tool) — the tool runs a 2nd time, often
        // returns an error (the resource was already consumed). Clear it → the next turn is clean.
        chief.clearNeedsContextPrependFor(targetSid);
      }
      emit("ajan_durum_degisti", { agent: "sef", durum: "durduruldu" });
      // The next pending command — runCommand finalizes and does not get stuck
      // in pausedSids; queue.process already moves to the next pending in the
      // handler loop. Still, if durdur was pressed while idle there is no runner;
      // trigger queue.process explicitly. It does not spawn for paused sids (gate callback).
      void queue.process(dispatchRunCommand, (sid) => isPausedFor(sid));
    } else if (aksiyon === "devam") {
      // Fix STOP-5: devam = clear the pause flags (durable pause ends) and
      // dispatch pending commands via queue.process. If a sessionId is given,
      // clear only that session's pause; otherwise all of them (backward compat).
      if (pauseTracker.pauseStartedAt > 0) {
        pauseTracker.pausedDurationMs += Date.now() - pauseTracker.pauseStartedAt;
        pauseTracker.pauseStartedAt = 0;
      }
      if (sessionId) pauseTracker.removePaused(sessionId);
      else pauseTracker.clearPaused();
      emit("ajan_durum_degisti", { agent: "sef", durum: "devam" });
      void queue.process(dispatchRunCommand, (sid) => isPausedFor(sid));
    } else if (aksiyon === "plan_ac") {
      state.planMode = true;
      emit("ajan_durum_degisti", { agent: "sef", durum: "plan_modu_acik" });
    } else if (aksiyon === "plan_kapat") {
      state.planMode = false;
      emit("ajan_durum_degisti", { agent: "sef", durum: "plan_modu_kapali" });
    }
  };
}
