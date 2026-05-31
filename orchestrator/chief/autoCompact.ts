// runCompact + maybeAutoCompact — the chief conversation summarization flow.
//
// Responsibilities:
//   - /compact slash or context-threshold trigger.
//   - Calls runChiefAttempt to produce a summary, creates a new starting point via
//     chief.setCompactFor + clearSessionIdFor.
//   - The double-compact guard (compactInProgress + COMPACT_DEBOUNCE_MS) lives here.
//
// F9: further main.ts splitting — factory pattern.

import type { Command } from "../queue.js";
import type { Logger } from "../logger.js";
import type { ArchitectServer } from "../server.js";
import type { SessionStore } from "../sessionStore.js";
import type { RunnerState } from "../state.js";
import type { RunChiefAttemptFn } from "./runChiefAttempt.js";

// M3: the source field — "manual_slash" (user), "user_threshold" (95% automatic),
// "silent_cache_cold" (removed). Reflected in the compact_yapildi event and as a
// system note in the chatLog.
export type CompactKaynak =
  | "manual_slash"
  | "user_threshold"
  | "silent_cache_cold";

export interface AutoCompactDeps {
  isAdvisor: boolean;
  chief: SessionStore;
  server: ArchitectServer;
  logger: Logger;
  state: RunnerState;
  runChiefAttempt: RunChiefAttemptFn;
  sessionModelFor: (sid: string) => string;
  // Threshold function — model-aware (1m vs 200k window).
  chiefAutoCompactThreshold: (sid?: string) => number;
  // Status push + module-mirror sync (if on the active tab).
  pushStatus: () => void;
  syncSessionState: () => void;
  // Module-level lastContext mirror — used in UI getStatus.
  setLastContextIfActive: (sid: string, ctx: number) => void;
  // Module-level compactSummary mirror — used in UI getStatus.
  setCompactSummaryIfActive: (sid: string, sum: string) => void;
  // Recent turns fragment — for the Fix 95 prepend preparation.
  buildRecentTurnsFragment: (sid: string, turnCount: number) => string;
  // Fix 127: after auto-compact, enqueues a "continue from where you left off" turn.
  // Bound to queue.enqueue; the active processOne loop picks it up in order.
  enqueueContinue: (sid: string) => void;
}

export interface AutoCompactApi {
  runCompact: (cmd: Command, kaynak?: CompactKaynak) => Promise<void>;
  maybeAutoCompact: (sid: string) => Promise<void>;
}

// Fix 86: prevent double-compact. runCompact can be triggered in parallel/sequence
// (UI gauge click x2, or the user quickly typing "/compact"). Previously there was no
// guard — the second trigger ran on an empty session and froze the screen.
// compactInProgress: the set of sids currently compacting.
// lastCompactEndedAt: sid -> end timestamp; a second /compact within <3s is debounced,
// returns a no-op reply.
const COMPACT_DEBOUNCE_MS = 3000;

export function createAutoCompact(deps: AutoCompactDeps): AutoCompactApi {
  const {
    isAdvisor,
    chief,
    server,
    logger,
    state,
    runChiefAttempt,
    sessionModelFor,
    chiefAutoCompactThreshold,
    pushStatus,
    syncSessionState,
    setLastContextIfActive,
    setCompactSummaryIfActive,
    buildRecentTurnsFragment,
    enqueueContinue,
  } = deps;

  const compactInProgress = new Set<string>();
  const lastCompactEndedAt = new Map<string, number>();

  async function runCompact(
    cmd: Command,
    kaynak: CompactKaynak = "manual_slash",
    forceLegacy = false,
  ): Promise<void> {
    const sid = cmd.sessionId ?? chief.getActiveId();
    // Fix 86: guard double-compact. If a compact is already running or one completed
    // within 3s, REJECT the second — preventing a frozen screen + wasting 10-30k tokens.
    if (compactInProgress.has(sid)) {
      const note = "This session is already compacting — the second /compact was ignored.";
      chief.pushChatFor(sid, { role: "sef", text: note, ts: Date.now() });
      server.sendChiefReply(cmd.id, note, [], undefined, undefined, undefined, false, { sessionId: sid });
      server.sendTurBitti(cmd.id, false, false, sid);
      server.sendChiefIdle(cmd.id, false, sid);
      server.sendTamamenIdle(cmd.id, false, sid);
      logger.info("compact_double_reject", { sid, kaynak, reason: "in_progress" });
      return;
    }
    const lastEnd = lastCompactEndedAt.get(sid) ?? 0;
    if (lastEnd && Date.now() - lastEnd < COMPACT_DEBOUNCE_MS) {
      const note = "Compact just completed — re-triggered too soon, ignored.";
      chief.pushChatFor(sid, { role: "sef", text: note, ts: Date.now() });
      server.sendChiefReply(cmd.id, note, [], undefined, undefined, undefined, false, { sessionId: sid });
      server.sendTurBitti(cmd.id, false, false, sid);
      server.sendChiefIdle(cmd.id, false, sid);
      server.sendTamamenIdle(cmd.id, false, sid);
      logger.info("compact_double_reject", { sid, kaynak, reason: "debounce", elapsedMs: Date.now() - lastEnd });
      return;
    }
    compactInProgress.add(sid);
    try {
    // Fix 96: the UI already added the optimistic "/compact" message (sendCommand opt
    // push). If the backend pushChatFor's /compact, the chat snapshot contains /compact
    // twice in the lastClearTs reconcile overwrite → double display in the UI (reported).
    // Solution: the backend does not add the "/compact" user entry; the UI opt is enough.
    // Even though the /compact entry is lost on disk persist (chat.json), the critical
    // info compactSummary is in state.json; the /compact line in chat history is only a
    // UX flag — enough as soon as the user sees the opt message.
    if (sid === chief.getActiveId()) syncSessionState();
    pushStatus();

    // Fix 148b: NATIVE compaction ON -> do NOT delete the session. INSTEAD of the old
    // summary-turn + clearSessionIdFor flow (which creates a new session): on the next
    // turn pull autoCompactWindow to the floor and trigger native within the SAME
    // session (CC-identical). Manual /compact + safety-net (maybeAutoCompact links here)
    // both go through this path.
    if (process.env.ARCHITECT_NATIVE_COMPACT === "1" && !forceLegacy) {
      const ctx = chief.getStateFor(sid)?.contextTokens ?? 0;
      let note: string;
      if (ctx < 110_000) {
        // autoCompactWindow floor is 100k — below this native cannot be forced +
        // context is already low, compaction unnecessary. Session preserved, no-op.
        note = `Context is already low (~${Math.round(ctx / 1000)}k) — compaction unnecessary. Session preserved (unchanged).`;
        logger.info("native_compact_skip_low", { sid, ctx, kaynak });
      } else {
        // Force native on the next turn + enqueue a continue turn. Native compacts at
        // the start of resume, then processes the continue. session_id is PRESERVED
        // (NO clearSessionIdFor).
        chief.requestForceCompactFor(sid);
        enqueueContinue(sid);
        note = `Native compaction triggered (CC-identical) — on the next turn the context will be compacted within the SAME session, the session does NOT change. (~${Math.round(ctx / 1000)}k context)`;
        logger.info("native_compact_request", { sid, ctx, kaynak });
      }
      chief.pushChatFor(sid, { role: "sef", text: note, ts: Date.now() });
      if (sid === chief.getActiveId()) syncSessionState();
      server.sendChiefReply(cmd.id, note, [], undefined, undefined, undefined, false, { sessionId: sid });
      pushStatus();
      server.sendTurBitti(cmd.id, false, false, sid);
      server.sendChiefIdle(cmd.id, false, sid);
      server.sendTamamenIdle(cmd.id, false, sid);
      return;
    }

    const COMPACT_PROMPT =
      "CONVERSATION COMPACTION (/compact): Summarize our entire conversation so far. " +
      "Your output should contain ONLY the following sections, write no other intro/closing sentence:\n" +
      "1) Main topics and decisions made\n" +
      "2) Ongoing / unfinished tasks\n" +
      "3) The work you are currently on and the next step\n" +
      "4) Critical technical details and decisions to remember\n" +
      "Write concisely but completely. Do not write your role/identity into the summary — you already know it.";

    server.sendChiefPartial(cmd.id, "", true, false, sid);
    const r = await runChiefAttempt(
      sid,
      COMPACT_PROMPT,
      false,
      (d) => server.sendChiefPartial(cmd.id, d, false, false, sid),
      undefined,
      (id, ad, durum) => server.sendAktivite(cmd.id, id, ad, durum, false, sid),
      (lin, lout, ctx) => {
        chief.setContextFor(sid, ctx);
        setLastContextIfActive(sid, ctx);
        server.sendChiefToken(cmd.id, lin, lout, ctx, false, { sessionId: sid });
      },
    );

    let note: string;
    if (r.reply && !r.transient) {
      const summary = r.reply.trim();
      chief.setCompactFor(sid, summary);
      chief.clearSessionIdFor(sid, `compact:${kaynak}`);
      server.sendChiefToken(cmd.id, 0, 0, 0, false, { sessionId: sid });
      chief.setContextFor(sid, 0);
      if (sid === chief.getActiveId()) {
        setCompactSummaryIfActive(sid, summary);
        setLastContextIfActive(sid, 0);
      }
      // Fix 95: after compact, prepend the summary + the last turn's raw fragment in
      // front of the NEXT user message. Putting it in the system prompt was not enough
      // (the agent reads the summary as an "instruction", does not interpret it as
      // "history"). The raw text of the last 3 turns as a raw fragment is a backup —
      // when the summary swallows detail, the micro-turn info (user asked X, chief said
      // Y) compensates.
      const lastTurnsFragment = buildRecentTurnsFragment(sid, 3);
      chief.setNeedsContextPrependFor(sid, lastTurnsFragment);
      // Fix 58: clear message to the user. If kaynak=user_threshold it is an automatic
      // trigger, if manual it is the reply to the user.
      if (kaynak === "user_threshold") {
        note = `The conversation was compacted automatically (auto-compact). The context limit was approaching, so the earlier conversation was squeezed into a ${summary.length}-character summary. You can keep talking — the earlier context is preserved as a summary.`;
      } else if (kaynak === "silent_cache_cold") {
        note = `The conversation was compacted silently (cache cold). Summary ${summary.length} chars.`;
      } else {
        note = `The conversation was compacted. Summary ${summary.length} characters — it will be injected as context in subsequent turns.`;
      }
      logger.info("compact_yapildi", {
        kaynak,
        ozetUzunluk: summary.length,
      });
    } else {
      note = "The conversation could not be compacted (a transient error occurred). Please try again.";
    }
    chief.pushChatFor(sid, { role: "sef", text: note, ts: Date.now() });
    if (sid === chief.getActiveId()) syncSessionState();
    // Fix 87: to avoid losing the summary detail in the UI, add the entire
    // compactSummary to the chief reply. Previously sendChiefReply only sent the "The
    // conversation was compacted. Summary 5005 char" message — in the UI the streaming
    // partial summary (5k char preview) was overwritten by sendChiefReply, the user
    // could not see the summary. Now the note + summary preview go in a single text;
    // the UI renders markdown.
    let replyText = note;
    if (r.reply && !r.transient) {
      const sum = r.reply.trim();
      // Include the whole summary. compactSummary is 8k-capped, safe for UI render.
      replyText = `${note}\n\n---\n\n**Summary:**\n\n${sum}`;
    }
    server.sendChiefReply(cmd.id, replyText, [], undefined, undefined, undefined, false, { sessionId: sid });
    pushStatus();
    // Bug fix: the /compact turn-end signals were missing — the UI Thinking got stuck
    // and the test-agent waited for sef_tamamen_idle and timed out.
    server.sendTurBitti(cmd.id, false, false, sid);
    server.sendChiefIdle(cmd.id, false, sid);
    server.sendTamamenIdle(cmd.id, false, sid);
    } finally {
      // Fix 86: in all cases clear the guard and record the last-compact time.
      compactInProgress.delete(sid);
      lastCompactEndedAt.set(sid, Date.now());
    }
  }

  // Fix 49: Automatic compact RE-ENABLED. The old "disabled" logic waited for SDK
  // auto-trim when the user reached 100% context — but in Architect SDK auto-trim is
  // disabled (settingSources=[]) + when claude-agent-sdk interprets the old sessionId
  // it returns "No conversation found". In that case the chief loses context + an
  // extra 100k+ tokens are spent.
  //
  // New behavior: trigger an automatic /compact when chiefAutoCompactThreshold() is
  // exceeded. The threshold is model-aware: 1m model 500k, 200k model 150k. No warning
  // is given before this threshold; when reached, the chief finishes its own turn,
  // then /compact runs silently, the summary is written to disk, and the session is
  // reset. The compact itself eats a turn budget (~10-30k tokens), but is always
  // profitable against a 100k+ token saving.
  async function maybeAutoCompact(sid: string): Promise<void> {
    // Fix 148: when SDK native in-place compaction (ARCHITECT_NATIVE_COMPACT) is ON,
    // this manual threshold REMAINS as a SAFETY-NET. The native threshold
    // (nativeCompactWindow) is BELOW the manual one (e.g. sonnet 170k < 190k) —
    // normally native triggers first within the SAME session, the context never reaches
    // the manual threshold, this block stays dormant. BUT if native somehow does not
    // trigger (the SDK settings path did not work) the context climbs to the manual
    // threshold and this block kicks in to prevent unbounded growth (cost explosion).
    // The two do not race because the thresholds are separate; if native succeeds the
    // manual one never sees it.
    if (state.autoCompactRunning) return;
    // Look at the current sid's context value.
    const ctx = chief.getStateFor(sid)?.contextTokens ?? 0;
    // Fix 148c: when NATIVE is ON, LEAVE the normal auto-compact to the SDK native
    // default (model window: sonnet ~200k, opus ~1M) — Claude Code identical. Our
    // manual threshold (chiefAutoCompactThreshold 190k/900k) is NO LONGER ACTIVE; only
    // if the native default does NOT trigger AT ALL (ctx hits the model hard window) it
    // does a legacy compact as a last-resort backstop. So there is NO early (190k)
    // compact; like CC, only when the window fills.
    const nativeOnThreshold = process.env.ARCHITECT_NATIVE_COMPACT === "1";
    // Fix 154: the backstop threshold is ABOVE the native window (sonnet 150k / opus
    // 700k) but BELOW the model wall — native gets a chance to fire between turns; if
    // it misses, the legacy backstop (reset+summary+continue) kicks in here.
    const threshold = nativeOnThreshold
      ? (/opus/i.test(sessionModelFor(sid)) ? 850_000 : 185_000)
      : chiefAutoCompactThreshold(sid);
    if (ctx < threshold) return;
    // Do not auto-compact advisor sessions — advisor turns are short, no need. Applies
    // to the global architect and project chiefs.
    if (isAdvisor) return;
    state.autoCompactRunning = true;
    logger.info("auto_compact_tetik", { sid, ctx, threshold, model: sessionModelFor(sid) });
    try {
      // Create a compact command and run runCompact directly, outside the queue.
      // Create a new Command — so it does not mix into user turns.
      const autoCmd: Command = {
        id: `auto-compact-${Date.now()}`,
        text: "/compact",
        status: "isleniyor",
        createdAt: Date.now(),
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
        sessionId: sid,
        autonomous: true,
      };
      // Fix 148c: if we reached here, either NATIVE is off (old behavior) or NATIVE is
      // on BUT ctx hit the model hard-window backstop (= the native default did NOT
      // trigger AT ALL, broken). In both cases session-preserving native is not
      // possible/insufficient -> LEGACY summary+clear for guaranteed recovery. Trying
      // native-force again near the hard window risks API overflow.
      const nativeOn = process.env.ARCHITECT_NATIVE_COMPACT === "1";
      if (nativeOn) {
        logger.warn("native_default_failed_backstop", { sid, ctx });
      }
      await runCompact(autoCmd, "user_threshold", /*forceLegacy*/ true);
      // Fix 58: runCompact already printed a clear message to the user — an extra
      // "[Automatic...]" note here was redundant and showed two messages in the UI.
      if (sid === chief.getActiveId()) syncSessionState();
      pushStatus();
      // Fix 58: when auto-compact finishes, emit a CLEAN idle signal to the UI — since
      // we do not know the outer runCommand's cmd.id, send sef_tamamen_idle with a
      // "fresh" cmd id. The UI uses it to reset the global running flag. Since the
      // existing runCompact already emits idle for its own auto-compact cmd id, this is
      // a UI doublecheck.
      server.sendChiefIdle(`auto-compact-cleanup-${Date.now()}`, false, sid);
      server.sendTamamenIdle(`auto-compact-cleanup-${Date.now()}`, false, sid);
      // Fix 127: after compact DO NOT STOP — continue from where you left off. The old
      // behavior emitted compact + idle and stopped, the user complained "it does not
      // continue". Claude Code does the compact transparently and continues the task. A
      // continue turn is enqueued; the active processOne loop picks it up in order (the
      // compact summary is in context via needsContextPrepend). If the task is done the
      // chief briefly says "done" (cheap turn). Since compact lowers the context, no
      // re-compact->continue loop forms.
      // Fix 154: maybeAutoCompact ALWAYS calls runCompact with forceLegacy=true (above)
      // -> the legacy summary+clear path, which does NOT call enqueueContinue. So an
      // enqueue is ALWAYS needed here (NATIVE on/off does not matter). The previous code
      // skipped it when NATIVE was on -> the chief STOPPED after compact (P2).
      enqueueContinue(sid);
    } catch (e) {
      logger.error("auto_compact_hata", { sid, hata: (e as Error).message });
    } finally {
      state.autoCompactRunning = false;
    }
  }

  return { runCompact, maybeAutoCompact };
}
