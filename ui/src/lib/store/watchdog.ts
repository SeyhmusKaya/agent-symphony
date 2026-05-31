// ui/src/lib/store/watchdog.ts — Fix 91 + Fix 103 watchdog logic.
// Chief token-progress + nested-tool aware timeout. ProjectSession checks this
// every second in the universal timer; if idle > 180s and there is no nested
// tool, it sets runError.

// The backend has its OWN authoritative idle-watchdog: runChiefAttempt.ts
// IDLE_MS=300s (does not wait if there is a pending tool, interrupts the real
// chief-idle and throws a meaningful "no activity for 5 min" error). Put the UI
// watchdog ON TOP of it
// (600s) — so the backend handles real chief-idle FIRST, and the UI only
// catches real WS-death (backend completely silent). 180s was too tight: long
// thinking / monitor-wait turns produced a false "Response timeout".
const WATCHDOG_TIMEOUT_MS = 600_000;

export interface WatchdogState {
  lastSefActivity: number;
  // Fix 103: token snapshot — if liveIn is increasing the process is really
  // thinking (reasoning mode, no tool/partial event arrives). If stale, it is a
  // zombie process.
  lastWatchdogIn: number;
  lastWatchdogOut: number;
}

export function createWatchdog(): WatchdogState {
  return {
    lastSefActivity: 0,
    lastWatchdogIn: 0,
    lastWatchdogOut: 0,
  };
}

// Reset the counters at the start of a new turn.
export function resetWatchdog(s: WatchdogState): void {
  s.lastSefActivity = Date.now();
  s.lastWatchdogIn = 0;
  s.lastWatchdogOut = 0;
}

// Bump the timestamp when the chief emits real activity
// (partial/activity/turn_started/reply).
export function bumpWatchdogActivity(s: WatchdogState): void {
  s.lastSefActivity = Date.now();
}

// Fix 103: special for sef_token — bump ONLY if liveIn/Out is INCREASING.
// (Stale token event = zombie, not real thinking.)
export function bumpWatchdogIfTokensGrew(
  s: WatchdogState,
  curIn: number,
  curOut: number,
): void {
  if (curIn > s.lastWatchdogIn || curOut > s.lastWatchdogOut) {
    s.lastSefActivity = Date.now();
    s.lastWatchdogIn = curIn;
    s.lastWatchdogOut = curOut;
  }
}

// Fix 91: a nested tool may be running (talk_to_chief 10min).
// The parent chief does not emit a new sef_aktivite but the tool is really
// running. If there is a "calisiyor" status within canliAktivite the watchdog
// is silenced.
//
// Returns: null if there is no problem; a string is the runError message to show in the UI.
export function watchdogTimeoutMessage(
  s: WatchdogState,
  toolStillRunning: boolean,
): string | null {
  const idleMs = Date.now() - s.lastSefActivity;
  if (idleMs > WATCHDOG_TIMEOUT_MS && !toolStillRunning) {
    return "Connection timeout (10min) — backend is not responding.";
  }
  return null;
}
