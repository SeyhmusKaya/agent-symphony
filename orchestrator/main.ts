import { join } from "node:path";
import { AgentRegistry } from "./registry.js";
import { UsageTracker, TurnMetricsTracker } from "./usage.js";
import { FileCoordinator } from "./locks.js";
import { EventBus, type EventType } from "./events.js";
import { CommandQueue, type Command } from "./queue.js";
import { ArchitectServer, type Attachment } from "./server.js";
import { buildChiefTools } from "./tools.js";
import { spawnControlledRestart } from "./tools/systemTools.js";
import { CodeGraph, setActiveCodeGraph } from "./codegraph/index.js";
import type { SymbolRow } from "./codegraph/db.js";
import { type Effort } from "./effort.js";
import { ensureTeam } from "./project.js";
import { SessionStore, type SessionChatEntry } from "./sessionStore.js";
import { ProjectConfigStore } from "./config.js";
import { AuditLog } from "./audit.js";
// F1.3b: the HealthMonitor, killSpecialist, runSpecialistResilient, BgTaskManager
// imports were removed — the specialist subprocess + bg task subsystem was deleted.
import { SharedMemory, TaggedMemory } from "./memory.js";
import { NoteStore } from "./notes.js";
import { RepoCatalogStore } from "./repoCatalog.js";
import { Logger } from "./logger.js";
import { startExposeServer } from "./expose.js";
import { startNightlyReport } from "./nightlyReport.js";
import {
  CHIEF_PROMPT,
  GLOBAL_CHIEF_PROMPT,
} from "./prompts.js";
import { setPlugins, setAnthropicProxyBaseUrl } from "./runtime.js";
import { startAnthropicProxy, getProxyStats, setProxyLogger, setFastMode, setDeepSeekKey } from "./anthropicProxy.js";
import { loadProviders, saveProviders, is1mModel } from "./providers.js";
import {
  Fleet,
  GLOBAL_ID,
  listAllProjects,
  pruneStaleProjects,
  repoRoot,
  globalTeamDir,
  appDataDir,
  defaultPluginPaths,
} from "./fleet.js";
import { advisorByKey, advisorId } from "./advisors.js";
// F4: Cost control — daily cap + hourly burn + auto-fallback to sonnet.
import {
  BudgetManager,
  type BudgetRole,
} from "./budgetManager.js";
import { createIdentityHelpers } from "./identityAnchor.js";
import { ToolUsageStats } from "./toolUsageStats.js";
import {
  ErrorTracker,
  defaultPersistPath as errorTrackerPath,
  type RollbackTrigger,
} from "./errorTracker.js";
import {
  performAutoRollback,
  readLastRollback,
} from "./autoRollback.js";
// F3: Autonomous 3-Day Mode — job manager + notifier for multi-day tasks.
import { AutonomousManager } from "./autonomousMode.js";
import { Notifier } from "./notifications.js";

// F9: Split into helper modules.
import { CostTracker, PauseTracker, RunnerState } from "./state.js";
import { createRunChiefAttempt } from "./chief/runChiefAttempt.js";
import { createSessionQueryManager } from "./chief/sessionQuery.js";
import { createBgJobManager } from "./chief/bgJobs.js";
import { createAutoCompact } from "./chief/autoCompact.js";
export type { CompactKaynak } from "./chief/autoCompact.js";
import { createRunCommand } from "./chief/runCommand.js";
import { createQueueRunner } from "./queueRunner.js";
import { createStatusBuilder } from "./statusBuilder.js";
import { createCodegraphHandler } from "./codegraphHandler.js";
import { createChatHistoryHandler } from "./chatHistoryHandler.js";
import { createControlHandler } from "./controlHandler.js";
import { createCommandHandler } from "./commandHandler.js";
import { runGlobalBootstrap } from "./globalBootstrap.js";
import { loadChiefPrefs as loadPrefs, saveChiefPrefs as savePrefs } from "./chiefPrefs.js";
import { acquireLock, releaseLockFile } from "./lockFile.js";

const port = Number(process.argv[2] ?? 4317);
const arg3 = process.argv[3];
const isGlobal = arg3 === "--global";
const advisorKey = arg3 === "--advisor" ? process.argv[4] : undefined;
const advisor = advisorKey ? advisorByKey(advisorKey) : undefined;
const isAdvisor = !!advisor;

const projectRoot = isGlobal
  ? repoRoot()
  : isAdvisor
    ? join(appDataDir(), "advisors", advisor!.key)
    : (arg3 ?? process.cwd());

const paths = ensureTeam(projectRoot, isGlobal ? globalTeamDir() : undefined);

const fleet = new Fleet();
const projectEntry =
  isGlobal || isAdvisor
    ? undefined
    : listAllProjects().find((p) => p.path === projectRoot);
const projectId = isGlobal
  ? GLOBAL_ID
  : isAdvisor
    ? advisorId(advisor!.key)
    : (projectEntry?.id ?? projectRoot);
const projectName = isGlobal
  ? "Mimar"
  : isAdvisor
    ? advisor!.name
    : (projectEntry?.name ?? projectRoot);
const baseChiefPrompt = isGlobal
  ? GLOBAL_CHIEF_PROMPT
  : isAdvisor
    ? advisor!.prompt
    : CHIEF_PROMPT;

// Bug 2 fix: IDENTITY & PATH ANCHOR — prevent agent path hallucination.
// Inject a fixed cwd path into all roles (global Architect, advisor, project chief).
// Previous bug: the agent produced a wrong path like
// "C:\Users\seyhk\Desktop\architect" (instead of the user's "seyh\projeler\Architect").
// This function writes the explicit cwd into the IMMUTABLE block for each role —
// no hallucination of the Bash/Read/Edit/Write base path. projectRoot is set once
// at startup and does not change → cache stability is preserved (1 cache_create, infinite cache_read).
//
// NOTE: buildIdentityAnchor / buildProjectContext / buildRecentTurnsFragment
// were moved to the ./identityAnchor.ts factory. After chief/projectConfig is
// defined they are bound via `const idHelpers = createIdentityHelpers({...})`;
// the fns are destructured with the same names (below).

const lockFile = join(paths.team, "orchestrator.lock");
acquireLock(lockFile, port);
function releaseLock(): void {
  releaseLockFile(lockFile);
  try {
    fleet.unregister(projectId);
  } catch {
    /* ignore */
  }
}
// Graceful shutdown — before restart_self / SIGTERM / SIGINT:
//   1) Gently stop the active query (so a "kesildi" signal goes to the UI),
//   2) Flush cache/state to disk (the sessionId is already live in chief.json),
//   3) Release the lock.
// This way the UI does not get stuck on the old "Thinking" after rebuild/restart,
// and the context % value is preserved. The references below (activeQuery,
// saveContext, ...) are defined later in the file; since this function is called
// on a process event at runtime it does not hit TDZ.
let shuttingDown = false;
function gracefulShutdown(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    pauseTracker.interruptAll();
  } catch {
    /* ignore */
  }
  try { saveContext(); } catch { /* ignore */ }
  try { saveChatLog(); } catch { /* ignore */ }
  try { releaseLock(); } catch { /* ignore */ }
  // N3: clear the timers (so they do not delay process exit).
  // F1.3b: stuckTimer was removed (no specialist subprocess).
  try { if (scanInterval) clearInterval(scanInterval); } catch { /* ignore */ }
  // N2: queue debounce flush.
  try { queue?.flushSync?.(); } catch { /* ignore */ }
  // CodeGraph: watcher close + db close.
  try { void codeGraphInstance?.dispose(); } catch { /* ignore */ }
  try { logger?.info?.("graceful_shutdown", { reason }); } catch { /* ignore */ }
}
process.on("exit", () => gracefulShutdown("exit"));
process.on("SIGINT", () => {
  gracefulShutdown("SIGINT");
  process.exit(0);
});
process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM");
  process.exit(0);
});

// Fix 146: ROOT CAUSE — the orchestrator is a long-running server; a single
// unhandled promise rejection / uncaught exception KILLED THE WHOLE PROCESS in
// the Node v15+ default. Scenario: when the user pressed "durdur" during a chief
// cross-chief turn (talk_to_chief -> sendCommandAwait), the SDK query aborts; the
// in-process SDK bridge / orphan cross-chief promise rejected at the moment of
// abort and stayed uncaught ANYWHERE -> the process crashes -> the WS server
// closes -> the UI is stuck forever on "Connecting" (the backend port no longer
// accepts, the 2sn reconnect loop returns empty). Solution: a global guard — LOG
// the error, KEEP the process ALIVE. Even if a single turn crashes the server
// survives and the UI connection is not lost.
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
  try {
    logger?.error?.("unhandled_rejection", { hata: msg });
  } catch {
    /* logger not ready yet */
  }
  console.error("[unhandledRejection — process kept alive]", msg);
});
process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  try {
    logger?.error?.("uncaught_exception", { hata: msg });
  } catch {
    /* logger not ready yet */
  }
  console.error("[uncaughtException — process kept alive]", msg);
});

const projectConfig = new ProjectConfigStore(paths.config);
const registry = new AgentRegistry(paths.agents);
const usage = new UsageTracker(
  join(paths.team, "usage.json"),
  projectConfig.get().tokenGunlukLimit,
);
const locks = new FileCoordinator();
const bus = new EventBus();
const queue = new CommandQueue(paths.queue);
// Multi-session manager — replaces the old ChiefStore + supports multiple
// sessions. The API is backward compatible (getSessionId, setSessionId,
// clearSessionId, getLastClearReason, getLoadedToolsets, add/remove). Works on
// the active session; the user can send session_olustur/sec/sil over WS.
const chief = new SessionStore(
  paths.team,
  isGlobal ? "Head Architect" : isAdvisor ? advisor!.name : "Head Chief",
);

// Identity / project context / last-turn fragment helpers — we bind them here
// because chief + projectConfig are ready.
const {
  buildIdentityAnchor,
  buildProjectContext,
  buildRecentTurnsFragment,
} = createIdentityHelpers({
  isGlobal,
  isAdvisor,
  advisor,
  projectId,
  projectName,
  projectRoot,
  projectConfig,
  projectEntry,
  chief,
});

// FIX (memory loss after rebuild/restart): SDK session resume can be rejected
// after a process restart — when the app is closed the node orchestrator is
// killed, the `claude` CLI session the SDK spawned dies before it can flush to
// disk; on the next launch resume returns "session_expired". Result: the UI
// SHOWS the old chat but the agent's real context is EMPTY -> the agent gives a
// cold reply like "hi, how can I help" (as if it forgot the history without the
// user clearing). Solution (Claude Code logic): on each session's FIRST turn
// AFTER PROCESS START, prepend a summary of the last turns from the persisted
// chatLog + the compactSummary to the user message (the existing Fix 95
// mechanism: the needsContextPrepend flag). If resume does hold there is a small
// repetition (harmless); if it does not, the agent preserves context. The flag
// is consumed and cleared on the first turn (clearNeedsContextPrependFor).
// Fix 121: if the previous process died mid-turn via hard kill (rebuild), a
// _live half draft may remain at the end of the chat — turn off its flag (so
// incomplete becomes a persistent history entry, not overwritten by a new turn).
// Since all roles (mimar/sef/advisor) use the same chief store, one call covers all.
chief.sealLiveDraftsOnBoot();
for (const meta of chief.list()) {
  const chatFor = chief.getChatFor(meta.id);
  if (!chatFor || chatFor.length < 2) continue;
  const frag = buildRecentTurnsFragment(meta.id, 8);
  if (frag) chief.setNeedsContextPrependFor(meta.id, frag);
}

const audit = new AuditLog(join(paths.team, "audit.log"));
// F1.3b: HealthMonitor was removed — no specialist subprocess, stuck tracking
// is not needed for the Agent tool (integrated into the chief's SDK turn).
const logger = new Logger(join(appDataDir(), "logs"), projectName);
logger.info("orkestrator_basladi", { projectId, port, projectRoot, isGlobal, isAdvisor });

const memory = new SharedMemory(join(appDataDir(), "memory.json"));
const tagged = new TaggedMemory(join(appDataDir(), "tagged-memory.json"));
const notes = new NoteStore(join(appDataDir(), "notes.json"));
// Shared ecosystem GitHub tool/repo catalog — global JSON, shared by all agents.
const catalog = new RepoCatalogStore(join(appDataDir(), "tool-catalog.json"));
const toolUsageStats = new ToolUsageStats(join(paths.team, "toolUsage.json"));
// Items 2 & 3: delegation ratio + batch efficiency telemetry.
const turnMetrics = new TurnMetricsTracker(join(paths.team, "turnMetrics.json"));
// F4: budget manager — project-local persist. The covering role:
//   - Architect (global) -> 'mimar', cap perMimarDailyUsd
//   - Advisor       -> 'advisor', cap perAgentDailyUsd
//   - Project chief -> 'chief', cap perChiefDailyUsd
// Specialist/worker recordSpend is written under separate agent names; cap perAgentDailyUsd.
const budgetManager = new BudgetManager(join(paths.team, "budgets.json"));
const selfBudgetRole: BudgetRole = isGlobal ? "mimar" : isAdvisor ? "advisor" : "chief";
// One-time fallback notification — do not notify again within the same session.
const fallbackNotifiedSids = new Set<string>();

bus.on((e) => {
  audit.append(e);
  logger.log(e.type === "hata" ? "error" : "debug", `olay:${e.type}`, e.payload);
  // F1.3b: health.begin/end calls were removed — no specialist subprocess.
});

const emit = (type: string, payload: Record<string, unknown>) =>
  bus.emit(type as EventType, payload as never);

// N3: keep timer refs so they can be cleaned up on graceful shutdown.
let scanInterval: NodeJS.Timeout | null = null;
// CodeGraph: a pre-indexed code knowledge graph. Lazy-build, triggered
// automatically on the first request or at boot end. Stays null if disabled,
// tools say 'not active'.
let codeGraphInstance: CodeGraph | null = null;
let codeGraphBuilding = false;
async function ensureCodeGraph(): Promise<void> {
  if (codeGraphInstance || codeGraphBuilding) return;
  const cfg = projectConfig.get();
  const enabled = (cfg as unknown as { codegraph?: { enabled?: boolean } }).codegraph?.enabled !== false;
  if (!enabled) return;
  codeGraphBuilding = true;
  try {
    const g = new CodeGraph({
      rootDir: projectRoot,
      watch: true,
      onProgress: (p) => emit("codegraph_progress", { ...p }),
      onChange: (n) => emit("codegraph_reindex", { changed: n }),
    });
    emit("codegraph_progress", { phase: "build_start" });
    const result = await g.build();
    g.startWatch();
    codeGraphInstance = g;
    setActiveCodeGraph(g);
    emit("codegraph_progress", {
      phase: "build_done",
      files: result.files,
      symbols: result.symbols,
      edges: result.edges,
      durationMs: result.durationMs,
    });
    logger.info("codegraph_hazir", result);
  } catch (e) {
    logger.error("codegraph_build_hata", { hata: (e as Error).message });
    emit("hata", { mesaj: `CodeGraph build error: ${(e as Error).message}` });
  } finally {
    codeGraphBuilding = false;
  }
}
// F1.3b: the stuckTimer/health.stuck() loop was removed — no specialist
// subprocess. Agent tool spawns are tied to the chief's turn; the chief's
// pause/interrupt method is enough.

setPlugins([...defaultPluginPaths(), ...projectConfig.get().plugins]);

// Anthropic 1h TTL cache proxy — open a tiny HTTP proxy on localhost, point the
// SDK subprocess's ANTHROPIC_BASE_URL here. The proxy injects cache_control:
// { ttl: "1h" } and the beta header into the /v1/messages body.
// Result: in a 200k context, if pause/draft is between 5-55 min the cache stays
// hot and re-bill is ~10x cheaper. The SDK and OAuth are untouched.
// Fix 52: route proxy diagnostics to the logger — console.log does not go out in
// a stdio:ignore child. For cache hit/miss analysis, proxy_cache events are
// written to the project log file.
setProxyLogger((msg, meta) => logger.info(`proxy:${msg}`, meta ?? {}));
// Hibrit DeepSeek routing: providers.json'daki key'i proxy'ye ver. Bos ise
// proxy DeepSeek'e yonlendirmez (Claude-only davranis korunur).
try {
  setDeepSeekKey(loadProviders().deepseekKey ?? "");
} catch {
  /* providers.json yok/bozuk — DeepSeek pasif */
}
void startAnthropicProxy()
  .then((proxy) => {
    setAnthropicProxyBaseUrl(proxy.baseUrl);
    logger.info("anthropic_proxy_started", { port: proxy.port });
  })
  .catch((e) => {
    logger.error("anthropic_proxy_failed", { mesaj: (e as Error).message });
    // If the proxy fails, the default Anthropic baseURL is used
    // (cache 5 min TTL fallback). The system keeps running.
  });

// Nightly report cron — only the global orchestrator runs it (otherwise a
// separate report is produced per project). Around 04:00 it collects the
// previous day's data from all projects' usage.json files, summarizes with
// Sonnet, and writes appData/com.seyh.architect/global/reports/YYYY-MM-DD.md.
const globalReportDir = join(appDataDir(), "global", "reports");
if (isGlobal) {
  // Fix 80: stale projectId startup prune — if project paths no longer on disk
  // remain in projects.json, talk_to_chief tries to spawn, then produces a
  // spawn_fail with "Target orchestrator could not be started". Prune silently at
  // Architect boot, write each to the audit log (logger.info).
  // Before deleting, ProjectStore.pruneStale() takes a projects.json.bak backup.
  try {
    const pruned = pruneStaleProjects();
    for (const p of pruned) {
      logger.info("project_pruned", {
        id: p.id,
        name: p.name,
        path: p.path,
        sebep: "path_missing",
      });
    }
    if (pruned.length > 0) {
      logger.info("project_prune_ozet", { silinen: pruned.length });
    }
  } catch (e) {
    logger.error("project_prune_hata", { mesaj: (e as Error).message });
  }

  const reportDir = globalReportDir;
  const usageFiles = listAllProjects()
    .map((p) => join(p.path, ".team", "usage.json"))
    .concat([join(globalTeamDir(), "usage.json")]);
  startNightlyReport({
    usageFiles,
    reportDir,
    log: (msg, meta) => logger.info(`nightly:${msg}`, meta ?? {}),
    projectsSnapshot: () =>
      listAllProjects().map((p) => ({
        id: p.id,
        name: p.name,
        lastOpened: p.lastOpened,
      })),
  });
  logger.info("nightly_report_started", { reportDir, usageFiles: usageFiles.length });
}

// User multiple-choice question — askId → resolve callback. The orchestrator
// holds the tool promise until the user's answer arrives.
const askMap = new Map<string, (cevap: string) => void>();
let askSeq = 0;
function askUser(
  soru: string,
  secenekler: string[],
  cokluSecim: boolean,
  serbestMetin: boolean,
): Promise<string> {
  const askId = `ask-${Date.now()}-${++askSeq}`;
  return new Promise<string>((resolve) => {
    let settled = false;
    const safeResolve = (cevap: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      askMap.delete(askId);
      resolve(cevap);
    };
    askMap.set(askId, safeResolve);
    // PERSIST: write the agent_question message to chatLog. So the UI can redraw
    // after restart / session reload, nothing lost. Keeping it UI-only in-memory
    // caused issues in the sef_cevap miss + applyStatus reconcile chain.
    chatLog.push({
      role: "agent_question",
      text: soru,
      ts: Date.now(),
      askId,
      secenekler,
      cokluSecim,
      serbestMetin,
    });
    saveChatLog();
    server.sendAjanSoru(askId, soru, secenekler, cokluSecim, serbestMetin);
    server.pushStatus(getStatus());
    // Auto-cancel if no answer arrives after 10 min — so the model does not hang.
    const timer = setTimeout(() => {
      safeResolve("(timed out — the user did not answer)");
    }, 600000);
  });
}

// F1.3b: bgTasksRef + BgTaskManager were removed — no fire-and-forget specialist
// subprocess. The chief blocking-spawns via the Agent tool; a fire-forget mode
// with Agent background:true may be considered later.
// A flag to trigger an end-of-turn auto-compact after an advisor interaction.
// Becomes true when the talk_to_chief tool returns an advisor reply, checked at
// the end of runCommand and a silent compact is run.
// → moved into state.advisorInteractionPending.

// Dynamic tool loading — when the load_toolset tool is called it is written
// PERSISTENTLY to chief.json; it stays open after restart. The old
// "pendingExtraGroups" single-turn behavior was removed: intent-based (regex)
// ones come automatically on every message, persistent needs are opened once
// with load_toolset. runChiefAttempt reads chief.getLoadedToolsets() as extraGroups.

// F3: Notifier + AutonomousManager. We wrap the Notifier with emit; an
// "autonomous_notification" event is sent to the UI + webhook/email channels opt-in.
const notifier = new Notifier({
  appDataDir: appDataDir(),
  emit: (k, p) => emit(k as EventType, p),
  logger: {
    info: (m, x) => logger.info(m, x ?? {}),
    warn: (m, x) => logger.warn(m, x ?? {}),
  },
});
// Autonomous job manager — a separate file per chief projectId. Not used by
// advisors but cheap to create; tools access it via the ctx.autonomousManager getter.
const autonomousManager = new AutonomousManager({
  appDataDir: appDataDir(),
  sefProjectId: projectId,
  emit: (k, p) => emit(k as EventType, p),
  notifier,
  logger: {
    info: (m, x) => logger.info(m, x ?? {}),
    warn: (m, x) => logger.warn(m, x ?? {}),
    error: (m, x) => logger.error(m, x ?? {}),
  },
});

// ---------------------------------------------------------------------------
// F9: shared mutable state instances. main.ts now carries state through these
// objects instead of direct single-module let-variables; the chief/* and
// statusBuilder/queueRunner factories take the same instances as deps.
// ---------------------------------------------------------------------------
const __prefs = loadPrefs(projectId);
const state = new RunnerState({
  chiefModel: __prefs.model,
  chiefEffort: __prefs.effort,
  chiefFast: __prefs.fast ?? false,
  planMode: projectConfig.get().planModu,
});
// Fast mode initial state — apply to the proxy. Per-turn runChiefAttempt resets
// it per session; this is just the correct starting point for pre-first-turn/
// non-turn requests.
setFastMode(state.chiefFast);
function saveChiefPrefs(): void {
  savePrefs(projectId, { model: state.chiefModel, effort: state.chiefEffort, fast: state.chiefFast });
}
const costTracker = new CostTracker();
const pauseTracker = new PauseTracker();

const chiefTools = buildChiefTools({
  registry,
  emit,
  projectRoot,
  usage,
  locks,
  audit,
  memory,
  tagged,
  notes,
  catalog,
  config: projectConfig,
  fleet,
  projectId,
  projectName,
  port,
  askUser,
  // F1.3b: the bgTasks ctx field was removed.
  markAdvisorInteraction: () => {
    state.advisorInteractionPending = true;
  },
  toolUsage: toolUsageStats,
  requestToolset: (groups) => {
    const yeni = chief.addLoadedToolsets(groups);
    logger.info("load_toolset_istegi", { gruplar: groups, persist: yeni });
  },
  // Fix 137: enqueue an autonomous continuation turn after load_toolset — the
  // new tools become active in the NEXT query, continuing without the user
  // sending a "continue" message. Into the active chief's session. If there is
  // already a pending command (queue full), do not re-add (unnecessary chain).
  // The processOne loop picks this up when the current turn finishes.
  requestToolsetContinue: (groups) => {
    const sid = chief.getActiveId();
    const zatenBekleyen = queue.pending().some((c) => (c.sessionId ?? "") === sid);
    if (zatenBekleyen) return;
    queue.enqueue(
      `[Auto continue] Tool group loaded (${groups.join(", ")}) — the new tool(s) are now active. CONTINUE your previous task from where you left off; do not wait for a user message.`,
      { autonomous: true, sessionId: sid },
    );
    logger.info("load_toolset_auto_continue", { gruplar: groups, sid });
  },
  unloadToolset: (groups) => {
    const kalan = chief.removeLoadedToolsets(groups);
    logger.info("unload_toolset_istegi", { gruplar: groups, kalan });
  },
  listLoadedToolsets: () => chief.getLoadedToolsets(),
  refreshStatus: () => server.pushStatus(getStatus()),
  codeGraph: () => codeGraphInstance,
  // Fix 89: the list_agents self field should show the active session model.
  getSessionModel: () => sessionModelFor(chief.getActiveId()),
  // F3: tools reach the autonomous job manager via this getter.
  autonomousManager: () => autonomousManager,
  // F4: budget manager getter — for the get_budget_report / set_budget_cap tools.
  budgetManager: () => budgetManager,
  // F1.3b: buildSpecialistEmitter was removed — no specialist subprocess.
});

const interrupted = queue.recover();
if (interrupted.length) {
  emit("hata", { mesaj: `${interrupted.length} half/ghost command(s) marked as "kesildi".` });
}

// Runtime error fingerprint tracking + auto-rollback.
// To detect a runChiefAttempt / proxy / tool exception loop and automatically
// return to the last healthy commit. Details: errorTracker.ts.
const errorTracker = new ErrorTracker({
  persistPath: errorTrackerPath(appDataDir()),
  onRollback: (trigger: RollbackTrigger) => {
    logger.error("auto_rollback_tetik", trigger);
    emit("hata", {
      mesaj: `Auto-rollback triggered: ${trigger.reason}`,
    });
    performAutoRollback(trigger, {
      repoRoot: repoRoot(),
      appDataDir: appDataDir(),
      port,
      nodeExec: process.execPath,
      childArgs: [...process.execArgv, ...process.argv.slice(1)],
      emit: (kind, payload) => emit(kind as EventType, payload),
    });
  },
});

// ---------------------------------------------------------------------------
// Per-session model/effort + auto-compact threshold helpers. Tied to
// RunnerState's chiefModel/chiefEffort; when the UI calls setChiefModel they are
// updated and persisted.
// ---------------------------------------------------------------------------

// Fix 104: Opus always 1M, Sonnet/Haiku always 200k. The old [1m] suffix is not needed.
// DeepSeek entegrasyonu: deepseek v4 de 1M context -> is1mModel ile birlestirildi.
// Bu fonksiyon SADECE 1M-context/auto-compact karari + pricing is1m icin kullanilir;
// deepseek pricing zaten priceForModel'de duz (is1m yok sayilir).
function isOpus(m: string): boolean {
  return is1mModel(m);
}

// Per-session model/effort resolution. If the session has a stored model use
// it, otherwise fall back to the project-level chiefModel/chiefEffort default.
// Backward compat: old state.json files have no model field → falls back to
// default, behavior is preserved exactly.
function sessionModelFor(sid: string): string {
  const m = chief.getModelFor(sid).model;
  return m && m.trim() ? m : state.chiefModel;
}
function sessionEffortFor(sid: string): Effort {
  const e = chief.getModelFor(sid).effort;
  return (e ?? state.chiefEffort) as Effort;
}
// Fast mode (priority service tier) per-session resolution. If the session has
// a stored fast use it, otherwise fall back to the project-level chiefFast default.
function sessionFastFor(sid: string): boolean {
  const f = chief.getModelFor(sid).fast;
  return f ?? state.chiefFast;
}

// TURN BUDGET: removed. The chief/specialist optimizes itself with tool
// selection and cost awareness; instead of a hard cap, the dynamic tool loading
// (load_toolset) philosophy — the constantly-used core is open, the rest is
// opened when needed.

// Automatic compact threshold — by model.
// Fix 138: OPUS threshold 300k -> 900k (user decision: use the 1M window to the
// fullest). 300k (Fix 133) was too aggressive: opus compacted at ~37% (measured
// ctx=374607) -> "I can't use the 1M" complaint. 900k = 90% of 1M.
// The cost risk (large cache_create on a cold turn) was reduced by Fix 133
// (WebFetch/WebSearch output cap) + Fix 136 (result-break); in an active chat the
// cache is hot (cache_read cheap). NOTE: at 900k the overflow margin is ~100k (a
// large in-turn overshoot can approach the 1M hard cap) — the user chose this knowingly.
// 200k window models are 190k.
function chiefAutoCompactThreshold(sid?: string): number {
  // Threshold by per-session model. If sid is not given, look at the active session's model.
  const effective = sid ? sessionModelFor(sid) : sessionModelFor(chief.getActiveId());
  return isOpus(effective) ? 900_000 : 190_000;
}

// chatLog / compactSummary / lastContext — hold a reference to the active
// session. If the active session changes, syncSessionState() re-binds them.
// The old single-session API surface is preserved: chatLog.push, saveChatLog,
// saveCompact, saveContext.
type ChatEntry = SessionChatEntry;
let chatLog: ChatEntry[] = chief.getChat();
let compactSummary: string = chief.getState().compactSummary;
let lastContext: number = chief.getState().contextTokens;

function syncSessionState(): void {
  chatLog = chief.getChat();
  compactSummary = chief.getState().compactSummary;
  lastContext = chief.getState().contextTokens;
}

function saveChatLog(): void {
  if (chatLog.length > 100) {
    chatLog = chatLog.slice(-100);
    chief.getActive().chat = chatLog;
  }
  chief.saveChat();
  // Update the lastTurnTs meta — so the UI session list shows it instantly.
  const lastTs = chatLog[chatLog.length - 1]?.ts ?? 0;
  if (lastTs) chief.setLastTurnTs(lastTs);
}

// saveCompact is not used — direct disk write is done via chief.setCompact.
// Still kept as the old API surface.
function saveCompact(): void {
  chief.setCompact(compactSummary);
}
void saveCompact;

function saveContext(): void {
  chief.setContext(lastContext);
}

// Module-mirror setters — chief/autoCompact.ts and chief/runCommand.ts want to
// update the module-level chatLog/compactSummary/lastContext only for the active
// tab from runChiefAttempt callbacks. The mirror access is wrapped in a fn.
function setLastContextIfActive(sid: string, ctx: number): void {
  if (sid === chief.getActiveId()) lastContext = ctx;
}
function setCompactSummaryIfActive(sid: string, sum: string): void {
  if (sid === chief.getActiveId()) compactSummary = sum;
}

// Prompt cache TTL tracking — we use the Anthropic prompt cache 1h TTL
// (anthropicProxy.ts injects cache_control: { ttl: "1h" } + the beta header
// extended-cache-ttl-2025-04-11). In a 1h window instead of the default 5 min,
// the cache stays hot during pause/draft. We set the cold threshold to 55 min
// (1h minus margin). If exceeded, a silent compact is triggered.
// Moved into state.lastChiefTurnTs / state.skipMemSysOnNextTurn.

// Command attachments (image/file) — kept in memory instead of writing to disk
// with the queue (so base64 does not bloat), matched by command id.
const attachMap = new Map<string, Attachment[]>();

// F1.3b: the BgTaskManager + bgTasks instance were removed — no fire-and-forget
// specialist subprocess. resetChain calls are now no-ops too (references below
// were cleaned up with null-checks for safety).

// ---------------------------------------------------------------------------
// F9: getStatus(), runChiefAttempt, runCompact, maybeAutoCompact, runCommand
// were moved to factories.
//
// Late-bind for the circular reference: ArchitectServer handlers take a
// reference to runCommand, but the runCommand factory expects server.send*
// calls. To break the cycle, the helper `dispatchRunCommand` let-variable binds
// to realRunCommand after the server is built. Handler closures call through
// this reference.
// ---------------------------------------------------------------------------

const getStatus = createStatusBuilder({
  isGlobal,
  registry,
  queue,
  chief,
  budgetManager,
  errorTracker,
  autonomousManager,
  pauseTracker,
  costTracker,
  appDataDir,
  sessionModelFor,
  sessionEffortFor,
  sessionFastFor,
  getChatLog: () => chatLog,
  getLastContext: () => lastContext,
  getProxyStats,
  readLastRollback,
});

// Late-bound runCommand. createRunCommand expects server.send* → assigned after
// the server is built. In the ServerHandlers.onCommand closure this variable is
// captured by REFERENCE; the call time is after the server is built → no TDZ.
let dispatchRunCommand: (cmd: Command) => Promise<void> = async () => {
  throw new Error("runCommand is not ready yet — bootstrap ordering error.");
};
function isPausedFor(sid: string): boolean { return pauseTracker.isPausedFor(sid); }

// F9: the WS handlers were split into separate modules — extracted from main.ts.
const onCommandHandler = createCommandHandler({
  chief,
  queue,
  logger,
  pauseTracker,
  state,
  attachMap,
  emit,
  pushStatus: () => server.pushStatus(getStatus()),
  server: null as never, // only for deps shape compatibility — the reference is not used.
  dispatchRunCommand: (cmd) => dispatchRunCommand(cmd),
});

const onControlHandler = createControlHandler({
  chief,
  queue,
  logger,
  pauseTracker,
  state,
  emit,
  buildRecentTurnsFragment,
  dispatchRunCommand: (cmd) => dispatchRunCommand(cmd),
});

const onCodegraphHandler = createCodegraphHandler({
  projectName,
  projectRoot,
  getCodeGraphInstance: () => codeGraphInstance,
  setCodeGraphInstance: (g) => { codeGraphInstance = g; },
  isBuilding: () => codeGraphBuilding,
  ensureCodeGraph,
});

const onChatHistoryHandler = createChatHistoryHandler({
  projectName,
  projectId,
  chief,
});

const server = new ArchitectServer(port, bus, {
  getStatus,
  onCommand: onCommandHandler,
  onSetModel: (model, effort, fast) => {
    // Per-session model: saved to the active session. The project-level
    // chiefModel is updated too → newly opened sessions take the last choice as
    // default + it persists in the prefs file (the default is preserved after UI
    // restart). It is also written to the active session's state.json → that
    // session keeps its own model when reopened (even if project-level changes).
    const activeSid = chief.getActiveId();
    if (model) state.chiefModel = model;
    if (effort) state.chiefEffort = effort;
    if (fast !== undefined) state.chiefFast = fast;
    chief.setModelFor(
      activeSid,
      model ?? state.chiefModel,
      (effort ?? state.chiefEffort) as Effort,
      fast !== undefined ? fast : sessionFastFor(activeSid),
    );
    saveChiefPrefs();
    // Reflect the fast toggle to the proxy instantly (the next turn's
    // runChiefAttempt resets it per session anyway; this is for instant feel in
    // the UI + intermediate requests).
    setFastMode(sessionFastFor(activeSid));
    emit("ajan_durum_degisti", {
      agent: "sef",
      durum: `model:${sessionModelFor(activeSid)}/${sessionEffortFor(activeSid)}${sessionFastFor(activeSid) ? "/fast" : ""}`,
    });
    server.pushStatus(getStatus());
  },
  onSetAgentModel: (agent, model, effort) => {
    try {
      registry.updateModel(agent, model, effort);
      const def = registry.get(agent);
      emit("ajan_durum_degisti", {
        agent,
        durum: `model:${def?.model ?? model}/${def?.effort ?? effort}`,
      });
    } catch (e) {
      emit("hata", { agent, mesaj: (e as Error).message });
    }
    server.pushStatus(getStatus());
  },
  onControl: onControlHandler,
  onUserAnswer: (askId, cevap) => {
    const resolve = askMap.get(askId);
    if (resolve) {
      askMap.delete(askId);
      resolve(cevap);
    }
    // PERSIST: mark the agent_question answered + add user_choice. Even if there
    // is NO resolve in askMap (an orphan answer after restart), persist is done
    // in all cases so the chat renders correctly.
    for (const m of chatLog) {
      if (m.role === "agent_question" && m.askId === askId && !m.answered) {
        m.answered = true;
        m.secim = cevap;
        break;
      }
    }
    chatLog.push({
      role: "user_choice",
      text: cevap,
      ts: Date.now(),
      askId,
    });
    saveChatLog();
    server.pushStatus(getStatus());
  },
  onSessionCreate: (ad) => {
    const meta = chief.create(ad);
    syncSessionState();
    logger.info("session_olustur", { id: meta.id, ad: meta.name });
    // Multi-session bug fix: do NOT INTERRUPT the active query when switching
    // sessions — work may be running in another session, do not stop it by mistake.
    server.pushStatus(getStatus());
  },
  onSessionSelect: (sessionId) => {
    const meta = chief.activate(sessionId);
    if (!meta) return;
    syncSessionState();
    // Do NOT INTERRUPT the active query (see comment above).
    logger.info("session_sec", { id: meta.id, ad: meta.name });
    server.pushStatus(getStatus());
  },
  onSessionDelete: (sessionId) => {
    // If the active one is being deleted, switch to primary first.
    const wasActive = chief.getActiveId() === sessionId;
    const ok = chief.remove(sessionId);
    if (!ok) {
      logger.warn("session_sil_reddedildi", { id: sessionId });
      return;
    }
    if (wasActive) {
      syncSessionState();
    }
    // P1.33: interrupt the deleted session's running query (if any).
    const dq = pauseTracker.getActiveQuery(sessionId);
    if (dq) {
      dq.interrupt().catch(() => {});
      pauseTracker.deleteActiveQuery(sessionId);
    }
    logger.info("session_sil", { id: sessionId, wasActive });
    server.pushStatus(getStatus());
  },
  onSessionRename: (sessionId, ad) => {
    chief.rename(sessionId, ad);
    server.pushStatus(getStatus());
  },
  // F1.3b: the onSpecialistMessage handler was removed — the UI specialist chat
  // surface was deleted in F1.2, the runSpecialistResilient subprocess flow in F1.3a/b.
  // Fix 55: chat history query (module: chatHistoryHandler.ts).
  onChatHistory: onChatHistoryHandler,
  // Fix 53: CodeGraph queries from UI (module: codegraphHandler.ts).
  onCodegraph: onCodegraphHandler,
  // F3 (autonomous 3-day mode): UI JobMonitor right-panel pause/resume/cancel.
  onAutonomousAction: (aksiyon, jobId) => {
    try {
      if (aksiyon === "pause") autonomousManager.pauseJob(jobId);
      else if (aksiyon === "resume") autonomousManager.resumeJob(jobId);
      else autonomousManager.cancelJob(jobId);
      server.pushStatus(getStatus());
      return { ok: true };
    } catch (e) {
      return { ok: false, hata: (e as Error).message };
    }
  },
  // F4 (Cost Control): UI BudgetCard cap edit.
  onBudgetCap: (role, capUsd) => {
    try {
      const patch: Partial<import("./budgetManager.js").BudgetConfig> = {};
      if (role === "chief") patch.perChiefDailyUsd = capUsd;
      else if (role === "mimar") patch.perMimarDailyUsd = capUsd;
      else patch.perAgentDailyUsd = capUsd;
      budgetManager.updateConfig(patch);
      server.pushStatus(getStatus());
      return { ok: true };
    } catch (e) {
      return { ok: false, hata: (e as Error).message };
    }
  },
  // Architect restart_agent -> this agent controlledly restarts itself.
  // Same core as the restart_self tool (spawnControlledRestart): supervisor
  // child spawn + self exit after 1.5sn; rollback if it cannot come up in 45sn.
  onRestartSelf: (opts) => {
    emit("ajan_durum_degisti", { agent: "sef", durum: "yeniden_baslatiliyor" });
    spawnControlledRestart({ port, emit, not: opts.not, devamGorevi: opts.devamGorevi });
  },
  // Provider key'leri kaydet (providers.json) + bu orchestrator'in proxy'sine
  // CANLI uygula (DeepSeek routing hemen aktif). Diger orchestrator process'leri
  // (mimar/advisor/diger proje sefleri) providers.json'u boot'ta okur -> bir
  // sonraki restart'ta gecerli olur. Bos string = key temizle.
  onSetProviders: (deepseekKey, anthropicKey) => {
    try {
      saveProviders({
        deepseekKey: deepseekKey.trim() || undefined,
        anthropicKey: anthropicKey.trim() || undefined,
      });
      setDeepSeekKey(deepseekKey.trim());
      logger.info("providers_updated", {
        deepseek: deepseekKey ? "set" : "clear",
        anthropic: anthropicKey ? "set" : "clear",
      });
    } catch (e) {
      logger.error("providers_update_failed", { mesaj: (e as Error).message });
    }
  },
});

// ---------------------------------------------------------------------------
// F9: the chief/* factories are created once the server is ready —
// runChiefAttempt does not touch the server, autoCompact/runCommand call server.send*.
// ---------------------------------------------------------------------------
// Fix 138 (Async delegation B): the persistent query manager. Used by
// runChiefAttempt only when ARCHITECT_PERSISTENT=1. When the bg specialist
// finishes (task_notification) it enqueues a resume turn to the SAME session —
// the chief wakes up and acts on the result. Flag OFF -> the instance stands but
// is never called (the old per-turn behavior).
// Fix 138: the background task completion handler — both B (sessionQueryMgr) and
// C (bgJobManager) use the same path: write the specialist result to the registry
// + enqueue a resume turn to the SAME chief session (the chief processes the result on a NEW turn).
const handleBgComplete = (
  sid: string,
  info: { specialist?: string; summary?: string; status: string; outputFile?: string },
) => {
  try {
    if (info.specialist) {
      registry.appendChat(info.specialist, {
        role: "uzman",
        text: info.summary || `[background task: ${info.status}]`,
        ts: Date.now(),
        hata: info.status !== "completed",
      });
    }
  } catch {
    /* registry best-effort */
  }
  const baslik =
    info.status === "completed" ? "COMPLETED" : info.status.toUpperCase();
  const note =
    `[BACKGROUND TASK ${baslik}` +
    (info.specialist ? ` — specialist: ${info.specialist}` : "") +
    `]\n` +
    (info.summary ? `Summary: ${info.summary}\n` : "") +
    (info.outputFile
      ? `Full output file: ${info.outputFile} (Read it if needed).\n`
      : "") +
    `Continue based on this result: relay to the user, take the next step if needed. ` +
    `If the result is enough report briefly, do not open an unnecessary turn.`;
  queue.enqueue(note, { sessionId: sid, autonomous: true });
  void queue.process(dispatchRunCommand, (s) => isPausedFor(s));
  try {
    server.pushStatus(getStatus());
  } catch {
    /* ignore */
  }
};

const sessionQueryMgr = createSessionQueryManager({
  logger,
  onBgComplete: (sid, info) => handleBgComplete(sid, info),
});

// Fix 138 (C): the host-orchestrated async delegation manager. When
// ARCHITECT_ASYNC_DELEGE=1, runChiefAttempt calls startJob on detecting a
// delege_arkaplan tool_use; the specialist runs in an independent query, and on
// finish handleBgComplete -> resume to the SAME session. Flag OFF -> the tool is
// not registered, the instance stands but is never called.
const bgJobManager = createBgJobManager({
  registry,
  projectRoot,
  usage,
  logger,
  onComplete: (sid, info) => handleBgComplete(sid, info),
  onStatus: () => {
    try {
      server.pushStatus(getStatus());
    } catch {
      /* ignore */
    }
  },
});

const runChiefAttempt = createRunChiefAttempt({
  isGlobal,
  isAdvisor,
  advisor,
  projectId,
  projectName,
  projectRoot,
  baseChiefPrompt,
  selfBudgetRole,
  registry,
  usage,
  turnMetrics,
  toolUsageStats,
  errorTracker,
  budgetManager,
  chief,
  tagged,
  projectConfig,
  logger,
  chiefTools,
  emit,
  buildIdentityAnchor,
  buildProjectContext,
  sessionModelFor,
  sessionEffortFor,
  sessionFastFor,
  isOpus,
  state,
  costTracker,
  pauseTracker,
  fallbackNotifiedSids,
  codeGraphInstance: () => codeGraphInstance,
  pushStatus: () => server.pushStatus(getStatus()),
  sessionQueryMgr,
  bgJobManager,
});

const { runCompact, maybeAutoCompact } = createAutoCompact({
  isAdvisor,
  chief,
  server,
  logger,
  state,
  runChiefAttempt,
  sessionModelFor,
  chiefAutoCompactThreshold,
  pushStatus: () => server.pushStatus(getStatus()),
  syncSessionState,
  setLastContextIfActive,
  setCompactSummaryIfActive,
  buildRecentTurnsFragment,
  // Fix 127: enqueue a continuation turn after auto-compact. The active
  // processOne loop (the turn that triggered the compact is still running for
  // that sid) picks it up in order. autonomous=true: system-initiated, does not
  // fire a notification but streams normally in the UI (the user sees the
  // continuation live).
  enqueueContinue: (sid: string) => {
    queue.enqueue(
      "[Auto continue] The context was compacted. CONTINUE your previous task from where you left off (the compact summary is in context). If the task is already complete say 'completed' in one line, do not open an unnecessary turn.",
      { sessionId: sid, autonomous: true },
    );
  },
});

const realRunCommand = createRunCommand({
  isGlobal,
  paths: { commands: paths.commands },
  globalReportDir,
  attachMap,
  chief,
  queue,
  server,
  logger,
  state,
  pauseTracker,
  costTracker,
  autonomousManager,
  runChiefAttempt,
  runCompact,
  maybeAutoCompact,
  emit,
  pushStatus: () => server.pushStatus(getStatus()),
  syncSessionState,
  setLastContextIfActive,
});
dispatchRunCommand = realRunCommand;

// Queue runner + autonomous manager wiring.
const queueRunner = createQueueRunner({
  queue,
  chief,
  autonomousManager,
  logger,
  server,
  projectRoot,
  runCommand: dispatchRunCommand,
  isPausedFor,
  pushStatus: () => server.pushStatus(getStatus()),
  syncSessionState,
});
queueRunner.wireAutonomousManager();

const disari = projectConfig.get().disariAc;
if (disari.aktif && disari.token) {
  startExposeServer(disari.port, disari.token, registry);
  console.log(`Specialists exposed — port ${disari.port}`);
}

// If another orchestrator for the same projectId is still alive, kill it.
// When Tauri cannot clean up the old port after rebuild_ui/restart_self, the
// orphaned old process keeps running in parallel — the same queue.json +
// pending-update marker is processed twice (the double-reply bug).
const orphan = fleet.get(projectId);
if (orphan && orphan.pid !== process.pid && orphan.port !== port) {
  try {
    process.kill(orphan.pid);
    console.log(`Orphan orchestrator killed: pid=${orphan.pid} port=${orphan.port}`);
  } catch {
    /* already gone */
  }
}
fleet.register({ projectId, port, pid: process.pid, name: projectName, path: projectRoot });

if (isGlobal) {
  const { scanInterval: si } = runGlobalBootstrap({
    projectRoot,
    paths: { team: paths.team },
    globalReportDir,
    chief,
    queue,
    logger,
    server,
    getStatus,
    syncSessionState,
    queueRunnerKick: queueRunner.kick,
  });
  scanInterval = si;
}

// F4: daily budget reset — check every 10 min, reset the maps if the day changed.
// Instead of precisely triggering at local midnight, simple polling: BudgetManager
// resetDaily does a local-date check; no-op if the day did not change.
const budgetResetInterval = setInterval(() => {
  try {
    budgetManager.resetDaily();
  } catch {
    /* ignore */
  }
}, 10 * 60 * 1000);
// graceful shutdown budget flush + clear interval.
process.on("exit", () => {
  try { clearInterval(budgetResetInterval); } catch { /* ignore */ }
  try { budgetManager.flush(); } catch { /* ignore */ }
});

console.log(`Architect orchestrator running — port ${port}, project ${projectRoot}`);

// CodeGraph build after boot (async, non-blocking). Watch starts automatically.
// On error logger.error is written, tools say 'not active'.
setTimeout(() => { void ensureCodeGraph(); }, 3000);
