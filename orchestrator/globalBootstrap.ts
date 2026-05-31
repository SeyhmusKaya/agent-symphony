// Global (Architect) startup-only responsibilities:
//   - writing last-good.txt (auto-rollback target)
//   - pending-update marker atomic claim + postUpdatePrompt enqueue
//   - nightly scan (SCAN_PROMPT) — scanMarker file + 30 min poll
//
// F9 extra split: extracted from main.ts. Only called when isGlobal=true.

import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { appDataDir } from "./fleet.js";
import { postUpdatePrompt, SCAN_PROMPT } from "./prompts.js";
import type { SessionStore } from "./sessionStore.js";
import type { CommandQueue } from "./queue.js";
import type { Logger } from "./logger.js";
import type { ArchitectServer } from "./server.js";

export interface GlobalBootstrapDeps {
  projectRoot: string;
  paths: { team: string };
  globalReportDir: string;
  chief: SessionStore;
  queue: CommandQueue;
  logger: Logger;
  server: ArchitectServer;
  getStatus: () => unknown;
  syncSessionState: () => void;
  queueRunnerKick: () => void;
}

export interface GlobalBootstrapApi {
  scanInterval: NodeJS.Timeout | null;
}

export function runGlobalBootstrap(deps: GlobalBootstrapDeps): GlobalBootstrapApi {
  const {
    projectRoot,
    paths,
    globalReportDir,
    chief,
    queue,
    logger,
    server,
    getStatus,
    syncSessionState,
    queueRunnerKick,
  } = deps;

  // Save the last healthy git version — we started up successfully.
  try {
    const head = execSync("git rev-parse HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
    if (head) writeFileSync(join(appDataDir(), "last-good.txt"), head, "utf8");
  } catch {
    /* not a git repo — ignore */
  }

  // Is this a restart after an update? Give the Architect a check task.
  // post-update check + check-note verification + continuation task: ALL IN A
  // SINGLE TURN. Separate prompts = 2x model calls + 2x cache miss; a combined
  // single prompt is 50% cheaper.
  // ATOMIC marker read — move it to a temp file via rename. With two parallel
  // orchestrator startups only one succeeds the rename, the other gets ENOENT
  // and does NOT enqueue. Prevents a duplicate postUpdatePrompt response.
  const updateMarker = join(appDataDir(), "pending-update.json");
  const claimed = `${updateMarker}.claimed-${process.pid}`;
  let markerContent: string | null = null;
  try {
    renameSync(updateMarker, claimed);
    markerContent = readFileSync(claimed, "utf8");
    try {
      unlinkSync(claimed);
    } catch {
      /* ignore */
    }
  } catch {
    /* no marker or another process claimed it */
  }
  if (markerContent) {
    let not = "";
    let devamGorevi = "";
    let kontrolNotu = "";
    let kontrolNotuId = "";
    try {
      const parsed = JSON.parse(markerContent) as {
        not?: string;
        devamGorevi?: string;
        kontrolNotu?: string;
        kontrolNotuId?: string;
      };
      not = parsed.not ?? "";
      devamGorevi = parsed.devamGorevi ?? "";
      kontrolNotu = parsed.kontrolNotu ?? "";
      kontrolNotuId = parsed.kontrolNotuId ?? "";
    } catch {
      /* ignore */
    }
    // P1.31: the post-update autonomous turn must ALWAYS run in the primary
    // session (Head Architect/Head Chief). Even if a rebuild happened while the
    // user was on a secondary, the backend "verify git/state" turn should show
    // in primary — otherwise a secondary session is wrongly activated and shows
    // a weird message.
    const primaryId = chief.getPrimaryId();
    if (primaryId && primaryId !== chief.getActiveId()) {
      chief.activate(primaryId);
      syncSessionState();
    }
    // The single combined prompt is an autonomous turn — the UI shows it with a
    // background-busy badge and does NOT fire a notification.
    // Bug 1 fix: also pass the primary session's compact summary inline into the
    // prompt. It is already in the IMMUTABLE block of the system prompt, but
    // agent steering sometimes ignores the summary and says "no pending task".
    // Having it in the user message too guarantees attention. Cap 6000 char — so
    // postUpdatePrompt does not bloat.
    const primaryCompact = primaryId
      ? (chief.getStateFor(primaryId)?.compactSummary ?? "")
      : "";
    const compactInline = primaryCompact.length > 6000
      ? primaryCompact.slice(0, 3600) + "\n\n[... summary truncated ...]\n\n" + primaryCompact.slice(-2000)
      : primaryCompact;
    queue.enqueue(
      postUpdatePrompt(not, kontrolNotu, kontrolNotuId, devamGorevi, compactInline),
      { autonomous: true },
    );
    queueRunnerKick();
  }

  const scanMarker = join(paths.team, "lastScan.txt");

  function todayKeyLocal(): string {
    const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ,
    }).format(new Date());
  }

  function scanReportExists(dayKey: string): boolean {
    return existsSync(join(globalReportDir, `scan-${dayKey}.md`));
  }

  function lastScanKey(): string {
    try {
      if (existsSync(scanMarker)) return readFileSync(scanMarker, "utf8").trim();
    } catch { /* ignore */ }
    return "";
  }

  function enqueueScan(dayKey: string): void {
    writeFileSync(scanMarker, dayKey, "utf8");
    queue.enqueue(SCAN_PROMPT, { autonomous: true, isScan: true });
    server.pushStatus(getStatus());
    queueRunnerKick();
  }

  const checkScan = (): void => {
    const now = new Date();
    // Normal window between 02:00-06:00 at night
    if (now.getHours() < 2 || now.getHours() >= 6) return;
    const today = todayKeyLocal();
    if (lastScanKey() === today) return;
    enqueueScan(today);
  };

  // Startup catch-up: if the computer was off overnight, today's scan may not
  // have run yet. If started between 06:00-10:00, run it immediately.
  void (async () => {
    const now = new Date();
    const hour = now.getHours();
    if (hour >= 6 && hour < 10) {
      const today = todayKeyLocal();
      if (lastScanKey() !== today && !scanReportExists(today)) {
        logger.info("scan_startup_catchup", { day: today });
        enqueueScan(today);
      }
    }
  })();

  const scanInterval = setInterval(checkScan, 30 * 60 * 1000);
  setTimeout(checkScan, 15000);

  return { scanInterval };
}
