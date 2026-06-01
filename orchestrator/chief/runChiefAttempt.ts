// runChiefAttempt — a SINGLE attempt of the chief SDK turn (opens query() once,
// consumes the stream, does transient/orphan/half-plan analysis, fills in tool
// activities and $ cost). The outer retry/pause decisions belong to runCommand.
//
// F9 (further main.ts splitting): this function used to be ~1100 lines in main.ts.
// It was extracted via the factory pattern — bound with deps in the main.ts
// bootstrap, the resulting fn is used with the same signature.
//
// State access:
//   - RunnerState: read+write pendingReflection / lastReflection / reflectOnNextTurn /
//     skipMemSysOnNextTurn / planMode / lastChiefTurnTs.
//   - CostTracker: addSessionUsd / recordUsd.
//   - PauseTracker: setActiveQuery / deleteActiveQuery (sid-bound).
//   - fallbackNotifiedSids: budget fallback notification dedup (Set).

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionQueryManager } from "./sessionQuery.js";
import type { BgJobManager } from "./bgJobs.js";
import { buildEconomyHooks } from "../sdkHooks.js";
import type { AgentRegistry } from "../registry.js";
import type { UsageTracker, TurnMetricsTracker } from "../usage.js";
import { kaynakBelirle } from "../usage.js";
import type {
  Attachment,
  ToolActivity,
  ChatSegment,
} from "../server.js";
import type { CodeGraph } from "../codegraph/index.js";
import { buildAllowedToolNames, EXTERNAL_MCP_GATES } from "../toolGroups.js";
import { CACHE_BOUNDARY } from "../cacheMarker.js";
import { EFFORT_THINKING, pickEffort, type Effort } from "../effort.js";
import { reflect } from "../reflection.js";
import type { SessionStore } from "../sessionStore.js";
import type { ProjectConfigStore } from "../config.js";
import type { Logger } from "../logger.js";
import type { TaggedMemory } from "../memory.js";
import {
  PROMPT_MUH,
  N8N_NOTE,
  CODEGRAPH_HINT,
  TOOL_CATALOG_NOTE,
  BG_DELEGE_NOTE,
  ASYNC_DELEGE_NOTE,
} from "../prompts.js";
import { setPlugins, runtimeOptions } from "../runtime.js";
import { setFastMode } from "../anthropicProxy.js";
import { priceForModel, estimateCost } from "../pricing.js";
import {
  BudgetManager,
  FALLBACK_CHEAPER_MODEL,
  type BudgetRole,
} from "../budgetManager.js";
import { isTransient, kisalt, detectHalfPlan } from "../chiefUtils.js";
import { buildSdkAgents, toApiModel } from "../sdkAgents.js";
import { effectiveSkillNames, buildSkillPromptBlock } from "../skills.js";
import type { ToolUsageStats } from "../toolUsageStats.js";
import type { ErrorTracker } from "../errorTracker.js";
import type { AdvisorDef } from "../advisors.js";
import type { CostTracker, PauseTracker, RunnerState } from "../state.js";

// setPlugins call site — does not affect runChiefAttempt's load_toolset behavior, it
// is called at boot. Imported here only for type continuity.
void setPlugins;

// Fix 138 (Async delegation B): the persistent streaming query only kicks in when
// this flag is ON. OFF (default) -> the old per-turn query behavior is preserved
// exactly, the sessionQuery module is never used. So the live system stays on the
// proven path.
const PERSIST = process.env.ARCHITECT_PERSISTENT === "1";

// Fix 148 (CC-identical compaction): TURN ON the SDK native in-place compaction.
// Flag ON -> autoCompactEnabled+autoCompactWindow are injected into the query
// Options.settings layer (settingSources [] does NOT change; CLAUDE.md / user settings
// file is NOT loaded, no identity/cred leak). Native compaction runs within the SAME
// session when the context window fills: the SDK writes compact_boundary into the
// transcript, produces a summary, the next resume reads it correctly -> session_id is
// PRESERVED. Our old manual flow (summary turn + clearSessionIdFor -> new session)
// diverged from Claude Code so the user complained. When this flag is ON, autoCompact.ts
// maybeAutoCompact returns early (double-compact guard). Manual /compact (user button)
// stays on the old path — rare + user-triggered.
const NATIVE_COMPACT = process.env.ARCHITECT_NATIVE_COMPACT === "1";

export interface ChiefToolsLike {
  allTools: Array<{ name: string }>;
  buildServer: (allowed: Set<string>) => unknown;
}

export interface RunChiefAttemptDeps {
  // Bootstrap sabitleri
  isGlobal: boolean;
  isAdvisor: boolean;
  advisor: AdvisorDef | undefined;
  projectId: string;
  projectName: string;
  projectRoot: string;
  baseChiefPrompt: string;
  selfBudgetRole: BudgetRole;

  // Shared instances
  registry: AgentRegistry;
  usage: UsageTracker;
  turnMetrics: TurnMetricsTracker;
  toolUsageStats: ToolUsageStats;
  errorTracker: ErrorTracker;
  budgetManager: BudgetManager;
  chief: SessionStore;
  tagged: TaggedMemory;
  projectConfig: ProjectConfigStore;
  logger: Logger;
  chiefTools: ChiefToolsLike;

  // Module helpers
  emit: (type: string, payload: Record<string, unknown>) => void;
  buildIdentityAnchor: () => string;
  buildProjectContext: () => string;
  sessionModelFor: (sid: string) => string;
  sessionEffortFor: (sid: string) => Effort;
  sessionFastFor: (sid: string) => boolean;
  isOpus: (model: string) => boolean;

  // Mutable state
  state: RunnerState;
  costTracker: CostTracker;
  pauseTracker: PauseTracker;
  fallbackNotifiedSids: Set<string>;

  // Getters (state containing mutable globals)
  codeGraphInstance: () => CodeGraph | null;
  // Status push — to reflect the new runningSessions snapshot to the UI.
  pushStatus: () => void;
  // Fix 138: the persistent query manager (when ARCHITECT_PERSISTENT=1). Created in
  // main.ts — when the bg specialist finishes it enqueues a resume turn on the SAME
  // session via queue.enqueue. Flag OFF -> may be left undefined, not used.
  sessionQueryMgr?: SessionQueryManager;
  // Fix 138 (Async delegation C): the background job manager (when
  // ARCHITECT_ASYNC_DELEGE=1). When a delege_arkaplan tool_use is detected,
  // startJob(sid,...) is called; the specialist runs in an independent query, and when
  // done main.ts enqueues a resume on the SAME session. Flag OFF -> undefined, the tool
  // is not registered, never called.
  bgJobManager?: BgJobManager;
}

export interface RunChiefAttemptResult {
  reply: string;
  transient: boolean;
  aktivite: ToolActivity[];
  segments: ChatSegment[];
  cost: {
    in: number;
    out: number;
    cacheRead: number;
    cacheCreate1h: number;
    cacheCreate5m: number;
    uncached: number;
    usd: number;
    model: string;
  };
  images: string[];
  planYarim: boolean;
  orphanedTools: string[];
  // M1/M2: turn execution result flags
  autonomousFail: boolean;
  resumeLostReason: string | null;
}

export type RunChiefAttemptFn = (
  sid: string,
  prompt: string,
  resetSession: boolean,
  onDelta?: (delta: string) => void,
  ekler?: Attachment[],
  onAktivite?: (id: string, ad: string, durum: "calisiyor" | "bitti" | "hata") => void,
  onToken?: (
    liveIn: number,
    liveOut: number,
    context: number,
    extra?: {
      cacheRead: number;
      cacheCreate: number;
      uncached: number;
      usd: number;
      model: string;
    },
  ) => void,
  isAgentCall?: boolean,
  onAktiviteTokens?: (
    id: string,
    tokens: { in: number; out: number; cacheRead: number; cacheCreate: number; usd?: number },
  ) => void,
  onAktiviteIO?: (
    id: string,
    // Fix 128: "ilerleme" — subagent live progress text (written to the owner Agent
    // tool_use id, the card streams live).
    ioKind: "girdi" | "sonuc" | "ilerleme",
    text: string,
    hata?: boolean,
  ) => void,
) => Promise<RunChiefAttemptResult>;

export function createRunChiefAttempt(deps: RunChiefAttemptDeps): RunChiefAttemptFn {
  const {
    isGlobal,
    isAdvisor,
    advisor,
    projectId: _projectId,
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
    codeGraphInstance,
    pushStatus,
    sessionQueryMgr,
    bgJobManager,
  } = deps;
  void _projectId;
  // Fix 138 (Async delegation C): active if the flag + bg manager exist. Only the
  // project chief (not architect/advisor) — delegation specialists are tied to the
  // project chief.
  const ASYNC_DELEGE =
    process.env.ARCHITECT_ASYNC_DELEGE === "1" && !!bgJobManager && !isGlobal && !isAdvisor;

  return async function runChiefAttempt(
    sid,
    prompt,
    resetSession,
    onDelta,
    ekler,
    onAktivite,
    onToken,
    isAgentCall,
    onAktiviteTokens,
    onAktiviteIO,
  ) {
    // M36: Per-turn tool cap. In architect notes processing it blew up to 44-118
    // tools/turn at $1-3; this limit keeps the most expensive turns under control.
    const TOOL_LIMIT_PER_TURN = 12;
    void TOOL_LIMIT_PER_TURN;
    // CACHE STRATEGY (token saving — critical):
    // The MEMORY + COMPACTED + PLAN blocks rarely change → they go into the system
    // prompt and become part of the cache prefix. When memory changes, one cache_create,
    // all subsequent turns are cache_hit (10x cheaper). Previously each turn sent ~3-5k
    // tokens as uncached input.
    // reflectEk changes every turn → stays in the user message (cannot be cached).
    const planSys = state.planMode
      ? "\n\n[PLAN MODE ON] Before delegating, present your delegation plan to the user item by item and wait for approval. Do not give tasks to specialists until approval arrives."
      : "";
    // MEMORY REMOVED (user request): the memory tools + [MEMORY] system injection were
    // removed. Conversation memory is now ONLY the [CRITICAL CONTEXT]/[COMPACTED PRIOR
    // CONTEXT] compact block. memSys is always empty.
    if (state.skipMemSysOnNextTurn) state.skipMemSysOnNextTurn = false;
    const memSys = "";
    // SAVING: compactSummary capped at 8k characters. When a long summary enters the
    // system prompt it causes a big cache_create cost on the first turn; head+tail
    // truncate saves 5-10k tokens.
    // P1.33: per-session compactSummary — the module-level `compactSummary` is tied to
    // the active session, parallel runners were overwriting it. Read sid-bound.
    // Fix 46 CRITICAL: the compactSys conditional was REMOVED. Old logic: "if there is a
    // resume, do not include compactSys" → on the first turn compactSys entered the
    // IMMUTABLE block, on the second turn when resume became active compactSys became ""
    // → the immutable block CHANGED EVERY TURN → cache always MISS → 100k IN every turn.
    // New behavior: compactSys always included (if there is a summary). An extra 5-8k
    // tokens every turn but cache hit is guaranteed — the net gain is enormous (uncached/
    // create is 10-100x of cache_read at 1%, 1 compactSys instance = infinite cache hit).
    const compactForSid = chief.getStateFor(sid)?.compactSummary ?? "";
    const compactCapped = compactForSid && compactForSid.length > 8000
      ? compactForSid.slice(0, 4800) + "\n\n[... summary shortened ...]\n\n" + compactForSid.slice(-2400)
      : compactForSid;
    // Fix 85: aggressive label. The previous "[COMPACTED PRIOR CONTEXT]" heading looked
    // like an info note, the model ignored it and called memory_search/note_list on a
    // "where were we" question. The new heading stresses that the block MUST be read and
    // that no tool call should be MADE. The cache invalidates once (new prefix), then a
    // permanent cache hit.
    const compactSys = compactCapped
      ? `\n\n[CRITICAL CONTEXT — what came before in this conversation; MUST READ. If the user asks "where were we"/"latest status"/"where you left off"/"what were we doing"/"summary", ANSWER FROM THIS BLOCK; do NOT call tools like note_list/Grep — this block is already the conversation's memory.]\n${compactCapped}`
      : "";

    // The previous turn's critique — wait at most 2s. Otherwise skip. (Goes into the user message.)
    if (state.pendingReflection) {
      try {
        const r = await Promise.race([
          state.pendingReflection,
          new Promise<string>((res) => setTimeout(() => res(""), 2000)),
        ]);
        if (r && r !== "OK") state.lastReflection = r;
      } catch {
        /* ignore */
      }
      state.pendingReflection = null;
    }
    const reflectEk =
      state.lastReflection && state.lastReflection !== "OK"
        ? `[PREVIOUS TURN'S CRITIQUE — pay attention this turn]\n${state.lastReflection}\n\n`
        : "";
    state.lastReflection = null;
    // P0.3: the cross-agent directive is in the user message instead of the systemPrompt.
    // The systemPrompt stays fixed, the cache prefix is not broken. The directive is
    // still effective.
    // Fix 54: the start of the message already has a "[CALLING AGENT — system-verified]"
    // block (crosschief.ts buildIdentityPrefix). In this block the chief sees the
    // caller's type/name/projectId/sessionId. When the chief composes a reply or writes
    // an error report it references this identity, does not equivocate like "an agent".
    const agentCallEk = isAgentCall
      ? "[CROSS-AGENT CALL] This message was sent by another agent. Look at the [CALLING AGENT — system-verified] block at the start of the message: the caller's type + name + project/session ID is clearly written there. You may reference these in your reply (e.g. \"my reply to the Volpora chief\"). Do NOT ASK THE USER via ask_user_choice — the user is not in the chat, only the calling agent is waiting. Make the decision yourself, answer with the best assumption. KEEP IT SHORT: answer directly in 3-6 sentences, do not use lists/headings. The calling agent uses your info to compose its own reply; do not write long analysis/recommendations.\n\n"
      : "";

    // Fix 95: a ONE-TIME context prepend after compact or pause. Putting it in the
    // system prompt was not enough — the agent does not count the summary as history.
    // Putting it inline IN FRONT OF the user message looks like prior conversation
    // context to the Anthropic API, the agent properly interprets "the user did/asked
    // these before". After injection the flag is cleared (valid once).
    let contextPrependEk = "";
    if (!isAgentCall) {
      const prepInfo = chief.getNeedsContextPrependFor(sid);
      if (prepInfo.needs) {
        const compactSum = chief.getStateFor(sid)?.compactSummary ?? "";
        // 8k cap: so the summary + fragment total does not bloat the user message by 10k+.
        const compactPart = compactSum.length > 5000
          ? compactSum.slice(0, 4000) + "\n\n[... summary shortened ...]\n\n" + compactSum.slice(-800)
          : compactSum;
        const fragmentPart = prepInfo.fragment;
        if (compactPart || fragmentPart) {
          contextPrependEk =
            "[PRIOR CONVERSATION MEMORY — you are CONTINUING this conversation, this is NOT the first message.]\n\n";
          if (compactPart) {
            contextPrependEk += `## COMPACTED SUMMARY OF OUR CONVERSATION\n${compactPart}\n\n`;
          }
          if (fragmentPart) {
            contextPrependEk += `## RAW TEXT OF THE LAST TURNS (most recent order)\n${fragmentPart}\n\n`;
          }
          contextPrependEk +=
            "[THE BLOCK ABOVE IS THE EARLIER PART OF OUR CONVERSATION — you lived it, the user wrote it, you answered it. The new message below is the CONTINUATION of this conversation.]\n\n[NEW MESSAGE]:\n";
        }
        // Used once — lower the flag.
        chief.clearNeedsContextPrependFor(sid);
      }
    }

    let effectivePrompt = contextPrependEk + agentCallEk + reflectEk + prompt;

    // Attachments: text files are added inline to the prompt; images are sent as a
    // separate content block (a message-iterator prompt instead of a string).
    const dosyalar = (ekler ?? []).filter((e) => e.tur === "dosya");
    const resimler = (ekler ?? []).filter((e) => e.tur === "resim");
    const MAX_DOSYA_CHARS = 20_000;
    for (const d of dosyalar) {
      const icerik = d.veri.length > MAX_DOSYA_CHARS
        ? d.veri.slice(0, MAX_DOSYA_CHARS) + `\n… [${d.veri.length - MAX_DOSYA_CHARS} characters truncated]`
        : d.veri;
      effectivePrompt += `\n\n[FILE: ${d.ad}]\n${icerik}`;
    }
    const queryPrompt = resimler.length
      ? (async function* () {
          yield {
            type: "user" as const,
            parent_tool_use_id: null,
            session_id: "",
            message: {
              role: "user" as const,
              content: [
                { type: "text" as const, text: effectivePrompt },
                ...resimler.map((r) => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: r.mediaType ?? "image/png",
                    data: r.veri,
                  },
                })),
              ],
            },
          };
        })()
      : effectivePrompt;

    // Per-session model + effort. If a model is stored for the session use it,
    // otherwise the project-level default. Backward compat: old sessions fall to default.
    const sessionModelStored = sessionModelFor(sid);
    const sessionEffort = sessionEffortFor(sid);
    // The daily spending cap + auto-fallback system was REMOVED (user request: "it does
    // not work"). The model the user selected is ALWAYS used; the system does not
    // silently drop to a cheaper model. Cost is shown only as telemetry (Session $,
    // $/hour).
    const sessionModel = sessionModelStored;
    // FAST MODE: apply the priority service tier (auto) to the proxy for this turn.
    setFastMode(sessionFastFor(sid));
    const effectiveEffort = pickEffort(prompt, state.planMode, sessionEffort);
    // M5: extraGroups is now read from the persistent chief.json source (opened via
    // load_toolset + restart-friendly). Intent-based extra groups are opened separately
    // via regex, not persistent — only triggered within a message.
    const persistedToolsets = chief.getLoadedToolsetsFor(sid);

    // Fix 69: External MCP server lazy-load. Servers with large catalogs like
    // n8n/windows (~7+12=19 tools, ~6-9k tokens) are NOT loaded by default. When the
    // chief calls load_toolset(["mcp_n8n"]) it is added to the SDK config for that
    // session. It stays fixed for the session lifetime → cache prefix stability is
    // preserved: the same catalog for a whole session. Invalidated only at
    // load_toolset/unload_toolset moments (already a side effect of extraGroups change).
    // Unknown server names (those the user added manually) are ALWAYS active — backward
    // compat. Only the gates listed in EXTERNAL_MCP_GATES start closed (intent-based).
    const gatedServerNames = new Set(Object.values(EXTERNAL_MCP_GATES));
    const enabledGatedServers = new Set<string>();
    for (const g of persistedToolsets) {
      const serverName = EXTERNAL_MCP_GATES[g];
      if (serverName) enabledGatedServers.add(serverName);
    }
    const extraMcp: Record<string, unknown> = {};
    for (const m of projectConfig.get().mcpServers) {
      // Gated servers (n8n, windows) are included only when the relevant toolset is
      // open. Other user-defined servers always.
      if (gatedServerNames.has(m.name) && !enabledGatedServers.has(m.name)) continue;
      extraMcp[m.name] = m.config;
    }
    // Item 6: completely exclude tool schemas from the API (filter in
    // createSdkMcpServer). The disallowedTools method did NOT remove the schemas
    // (Anthropic SDK research); this way an unregistered tool never reaches the API.
    // Fix 138: in persistent mode, TURN OFF intent-based (prompt-dependent) tool
    // groups — if allowedSet changes every message the conn signature changes and the
    // persistent query is recreated every turn (persistence breaks). A neutral prompt
    // -> base + persistedToolsets (load_toolset) stays fixed. Tool schemas are sent once
    // at conn creation and are already cached.
    const allowedSet = buildAllowedToolNames({
      prompt: PERSIST ? "" : prompt,
      isGlobal,
      extraGroups: persistedToolsets,
    });
    // If a cross-agent call, remove ask_user_choice — so the calling agent does not
    // deadlock. The agent decides for itself. If the architect / advisor / chief opened
    // talk_to_chief to another agent, agentCall=true comes here.
    if (isAgentCall) {
      allowedSet.delete("ask_user_choice");
    }
    // Fix 138 (C): add the delege_arkaplan tool to allowedSet (otherwise it does not
    // enter the schema and the chief cannot call it). The tool is already registered in
    // delegateTools with flag+role gating.
    if (ASYNC_DELEGE) {
      allowedSet.add("delege_arkaplan");
    }
    const chiefServer = chiefTools.buildServer(allowedSet);
    const toolGroupSummary = {
      kept: allowedSet.size,
      dropped: chiefTools.allTools.length - allowedSet.size,
    };
    const resumeId = chief.getSessionIdFor(sid) && !resetSession ? chief.getSessionIdFor(sid) : null;
    // Fix 148b: if manual /compact or the safety-net FORCED native compaction this turn,
    // pull autoCompactWindow to the floor (100k). Native compacts at the start of resume
    // within the SAME session (session_id preserved, CC-identical). Otherwise the normal
    // model-aware threshold (opus 850k / 200k-model 170k).
    // On normal turns DO NOT SET autoCompactWindow -> the SDK uses its own default = the
    // model window (sonnet ~200k, opus ~1M), Claude Code's identical behavior. ONLY when
    // manual /compact or the safety-net requests "force" do we pull that turn to the 100k
    // floor and force native early.
    const forceCompactThisTurn = NATIVE_COMPACT && chief.consumeForceCompactFor(sid);
    // Fix 153: STANDING autoCompactWindow. Fix 148c's assumption "leave undefined, the
    // SDK compacts at the model window" was EMPIRICALLY WRONG: the in-process SDK passive
    // auto-compact never triggered at 200k -> native_default_failed_backstop -> legacy
    // fallback -> no-op via the clearSessionIdFor chokepoint (Fix 151) -> the context
    // NEVER shrank (stuck at ~120k, each backstop burned a ~$0.30 empty summary turn).
    // Solution: trigger native every turn at an OPEN window (session_id preserved =
    // CC-identical). The force turn forces earlier (100k); a normal turn is sonnet 190k
    // (below the 196k backstop, native fires first) / opus 850k.
    // Fix 154: 190k sonnet was too close to the 200k wall -> a single large turn passed
    // 190k and hit 200k, the backstop triggered before native could fire between turns
    // (1 native success / 7 backstops). Pull to 150k: leave native a ~35k band (150k
    // window < 185k backstop) so it compacts between turns = the session is preserved.
    // CC also compacts at ~80% (160k); 150k is equivalent/earlier-safe.
    const standingCompactWindow = /opus/i.test(sessionModel) ? 700_000 : 150_000;
    const effectiveCompactWindow: number | undefined = !NATIVE_COMPACT
      ? undefined
      : forceCompactThisTurn
        ? 100_000
        : standingCompactWindow;
    if (forceCompactThisTurn) {
      logger.info("native_compact_force", { sid, window: effectiveCompactWindow });
    }
    logger.info("sef_query_basla", {
      model: sessionModel,
      effort: effectiveEffort,
      effortKaynak: effectiveEffort === sessionEffort ? "user" : "auto",
      resume: !!resumeId,
      resumeId,
      promptUzunluk: effectivePrompt.length,
      dosyaEk: dosyalar.length,
      resimEk: resimler.length,
      planModu: state.planMode,
      toolKept: toolGroupSummary.kept,
      toolDropped: toolGroupSummary.dropped,
      persistedToolsets,
    });

    // Fix STOP-2: hard-abort controller. If interrupt() does not cut gracefully
    // (buffered stream, hung subprocess) controlHandler abort()s this.
    const abortController = new AbortController();
    // F2 skill injection: SDK skill discovery was settingSources=[] + since the skills
    // are in ~/.architect/skills/, the name list (options.skills) was NOT LOADING the
    // content. Solution: add the role's skill bodies directly to the systemPrompt.
    // skillRole = mimar | advisor-<key> | sef-<projectId>. The block is fixed for the
    // whole session → the cache prefix is not broken.
    const skillRole = isGlobal
      ? "mimar"
      : isAdvisor
        ? `advisor-${advisor!.key}`
        : `sef-${deps.projectId}`;
    const skillBlock = buildSkillPromptBlock(skillRole);
    // Fix 138: compute the systemPrompt separately — used by both makeOptions and the
    // persistent conn signature (the signature is systemPrompt + model + tools...; if it
    // changes the conn is recreated).
    // Fix 138: if persistent (ON) + chief/Architect, add the bg-delegation guide to the
    // IMMUTABLE block (part of the cache prefix, fixed for the session). OFF or advisor
    // -> not added (advisor does not use persistent; in OFF the bg subagent dies on the
    // per-turn query teardown).
    // Test safety: persistent is only on PROJECT CHIEFS (EXCLUDING Architect=isGlobal and
    // advisor). The Architect is a coordinator + the advisor is pure-persona — both stay
    // on the proven per-turn path, the test blast-radius is a single project chief. Once
    // proven, the isGlobal gate can be removed and opened to the Architect too.
    const persistEligible = PERSIST && !isAdvisor && !isGlobal;
    // Fix 138: C (async delegation, ASYNC_DELEGE) takes PRIORITY -> delege_arkaplan guide.
    // B (PERSIST/background:true) legacy/off -> the old BG_DELEGE_NOTE. If neither, empty.
    const bgNote = ASYNC_DELEGE
      ? ASYNC_DELEGE_NOTE
      : persistEligible
        ? BG_DELEGE_NOTE
        : "";
    const systemPromptStr = isAdvisor
      ? baseChiefPrompt + buildIdentityAnchor() + TOOL_CATALOG_NOTE + skillBlock + compactSys + CACHE_BOUNDARY + memSys + planSys
      : baseChiefPrompt + buildIdentityAnchor() + buildProjectContext() + PROMPT_MUH + N8N_NOTE + CODEGRAPH_HINT + TOOL_CATALOG_NOTE + bgNote + skillBlock +
        compactSys +
        CACHE_BOUNDARY +
        memSys + planSys;
    // Fix 138: produce the options body from a factory — OFF (per-turn query) and ON
    // (persistent createQuery) share the same options; abort + resume per-path.
    const makeOptions = (extra: { abort: AbortController; resume?: string }): Options => ({
        // Fix STOP-2: the controller for hard-aborting the query. When abort() is called
        // the SDK stream stops + resources are cleaned up.
        abortController: extra.abort,
        // Cache-friendly system prompt: rarely-changing blocks (MEMORY, COMPACT, PLAN
        // MODE) go here — part of the Anthropic prompt cache prefix. The frequently
        // changing one (reflectEk) stays in the user message.
        // Micro-saving: N8N_NOTE is loaded only on an SSH/n8n/workflow intent. Otherwise
        // it wastes ~700 bytes (~180 tokens) + the cache prefix.
        // P0.3 + P0.4: Cache prefix stability — the systemPrompt must be FIXED. The old
        // intent-based N8N_NOTE conditional and the isAgentCall extra directive broke the
        // cache prefix. N8N_NOTE is always included (~700 bytes in the fixed prefix). The
        // cross-agent directive was moved to the start of the user message (in the
        // queryPrompt construction below). memSys/compactSys/planSys are not mutable —
        // read deterministically from chief.json; cache-friendly.
        // P1.2: Cache boundary marker — the proxy catches it and splits the system prompt
        // into 2 cache blocks:
        //   [0] IMMUTABLE: baseChiefPrompt + PROMPT_MUH + N8N_NOTE +
        //       CODEGRAPH_HINT → gets cache_control, the prompt cache hit target.
        //   [1] MUTABLE: memSys + compactSys + planSys → re-tokenized only this block on
        //       each change via memory_remember / compact / plan toggle. The upper block
        //       is a cache hit.
        // Left of the marker is ~6k tokens cold-cache, 0 cost on subsequent turns.
        // P1.8 (advisor identity fix): Advisors do NOT get the PROMPT_MUH/N8N_NOTE/
        // CODEGRAPH_HINT extra. These blocks contain the Architect/Volpora/CodeGraph
        // names → the advisor says "I am an Architect specialist". The advisor gets only
        // the pure persona prompt → clean identity.
        // P1.20: compactSys was moved to the IMMUTABLE block. After /compact the
        // compactSummary changes → the immutable cache invalidates, 6k cacheCreate on the
        // next turn (if the compact summary is large).
        // HOWEVER: from subsequent turns the compactSummary stays cached, avoiding a 1k
        // uncached input cost every turn. Breakeven: after 2-3 turns the immutable
        // placement wins.
        // memSys and planSys are still mutable — they change more often (memory_remember,
        // plan toggle).
        // TOOL_CATALOG_NOTE contains no project name (identity-neutral) → given to the
        // advisor too; so ALL agents know the common tool catalog (user request).
        systemPrompt: systemPromptStr,
        // P1.8: let the SDK cwd be projectRoot (the advisor data dir) for the advisor —
        // otherwise the SDK reads CLAUDE.md from the Architect repo and adopts the "I am
        // an Architect specialist" identity.
        cwd: projectRoot,
        // Fix 104: a clean model slug for the SDK. A '-fast' / '[fast]' that may come from
        // the UI is stripped, for opus the '[1m]' alias is added (Anthropic opus is always 1m).
        model: toApiModel(sessionModel),
        maxThinkingTokens: EFFORT_THINKING[effectiveEffort],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        // Phase 1 (Task #98): native Anthropic Agent SDK subagent support. The
        // specialists in the registry are passed to SDK options.agents; the chief spawns
        // them in parallel in an isolated context via the "Agent" tool. Zero cold-start
        // cache_create blowup (shared prefix). The existing runSpecialist subprocess
        // structure keeps running in PARALLEL — persistent multi-turn conversations
        // (Volpora etc.) are preserved, the chief prefers the native Agent tool for
        // one-shot parallel work.
        agents: isAdvisor ? undefined : buildSdkAgents(registry, {
          chiefAllowedTools: [...allowedSet],
        }),
        // Fix 122: canUseTool HARD-DENY REMOVED. Old behavior (Fix 83/106/114): it denied
        // Grep/Bash/Glob/ls code-search patterns and forced code_search. In practice too
        // aggressive: legitimate Grep/Bash calls got a "rejected" error, agents got stuck,
        // a week-long problem. New approach: NO ENFORCEMENT. The CodeGraph preference is
        // written as a soft guideline in the SYSTEM PROMPT (see the baseChiefPrompt
        // codegraph section) — "code_search first, Grep/Bash only for work not in the
        // codegraph". No block at the tool level; the agent decides. canUseTool was
        // removed entirely -> the bypassPermissions default (allow-all) applies.
        // P1.19: settingSources [] — the "project" scope auto-loads CLAUDE.md. Volpora
        // CLAUDE.md is 78KB (~20k tokens), Architect CLAUDE.md ~10k tokens → 10-20k extra
        // prefix on every cold start. The chief system prompt already carries everything
        // needed; if necessary the chief reads CLAUDE.md manually with `Read`.
        // settingSources=[] -> "no auto memory injection" -> cold start drops 10-20k.
        // NOTE: SDK still loads .mcp.json + .claude/agents/ etc via [], but the CLAUDE.md
        // memory file is loaded ONLY with the "project" scope.
        settingSources: [],
        // P0.1: Cache prefix stability — the tools array is FIXED.
        // P1.33: WebSearch only for the advisor. The Chief/Architect job is coordination —
        // SEO/marketing/web research + URL reading should be handed to the advisor.
        // Fix 129: NotebookEdit was REMOVED from the chief (no .ipynb in the projects, dead
        // weight). WebFetch was ADDED BACK (Fix 133): the prompt says "WebFetch for page
        // HTML" + the chief needs to fetch official URLs/releases/docs in project work
        // (e.g. an APK release link). When removed it caused a "no tool" error + the chief
        // left work half-done. WebSearch stays exclusive to the advisor (broad web research
        // = advisor work). Cache prefix stability: chief 8, advisor 9.
        // ROOT FIX (specialist delegation): the "Agent" SDK built-in subagent tool was
        // added to the chief list. The `tools` whitelist = "base set of available built-in
        // tools" (SDK doc) — an explicit array opens ONLY the listed ones. While Agent was
        // NOT in the list, even with options.agents populated the chief could not call
        // Agent(subagent_type=<specialist>); it fell to the mcp__architect__task worker
        // (does not reach the registered specialist, the registry chat stays empty). Since
        // agents:undefined for the advisor, the Agent tool is NOT added to the advisor
        // (useless, the cache prefix stays separate).
        tools: isAdvisor
          ? ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "WebSearch", "WebFetch", "NotebookEdit"]
          : ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "WebFetch", "Agent"],
        // SKILLS (F2): the anthropics-skills plugin loads ~17 SKILL.md frontmatters (~2k
        // tokens cold). Empty array = load none (default).
        // F2: we extract a name list from the
        // ~/.architect/skills/{global,mimar,advisor-<key>,sef-<projectId>} folders and
        // pass it as the enable list. NO file → empty list → no cold cost. File EXISTS →
        // the SDK filters by skill names, injecting only those belonging to our role into
        // the main session system prompt. SAFE FALLBACK: if there is no skill folder at
        // all, effectiveSkillNames returns empty, the old "skills: []" behavior is
        // preserved. NOTE: the skill content is injected into the systemPrompt via
        // skillBlock (see above). This field stays as a name list for SDK-discovery
        // compatibility; it is not resolved when settingSources=[] but is harmless.
        skills: effectiveSkillNames(skillRole),
        mcpServers: { architect: chiefServer, ...extraMcp } as never,
        // Item 5: required for text_delta narration. The stream_event flow comes through
        // but below only content_block_delta/text_delta and tool_use start are filtered —
        // other events (reasoning delta, tool_use input delta, ping etc.) are dropped.
        // Partial messages do not change billing; the only extra cost is event parse
        // overhead (very low). UX: Claude Code style, the chief text streams live between
        // tools.
        includePartialMessages: true,
        // Fix 128: forward the text + tool activity inside a subagent (native Agent tool)
        // to the parent stream via parent_tool_use_id. When default false only
        // tool_use/tool_result heartbeats came through; the subagent's live thinking/text
        // never came, the parent chat stayed "Thinking...". With true the SDK relays the
        // subagent conversation tagged with parent_tool_use_id → we reflect live progress
        // onto the owner Agent card (the stream loop below).
        forwardSubagentText: true,
        // M36/M37: the tool cap is OFF for the Chief (toolLimit=0). The Architect/project
        // chief is a coordinator/refactor role — 10-20 tables or multi-file edit work can
        // require 30+ tools. When the cap denied, it left work half-done. Token saving
        // only via output compress (PostToolUse) — no quality loss. The cap is active for
        // worker/specialist/task (they are focused, short work).
        hooks: buildEconomyHooks({
          toolLimit: 0,
          // Fix 72: 6000 → 3000. sdkHooks already does a smart head 60% + tail 30%
          // truncate — at a 3k cap, head 1800 + tail 900 is enough for most npm/git/grep
          // output. -50% bloat in the tool result history.
          outputCap: 3000,
          label: isGlobal ? "Mimar" : "Sef",
        }) as never,
        ...runtimeOptions(),
        stderr: (data: string) => {
          console.error("[claude-code stderr]", data);
          logger.warn("claude_stderr", data);
        },
        ...(extra.resume ? { resume: extra.resume } : {}),
        // Fix 148: native in-place compaction (CC-identical). autoCompact* injected into
        // the settings layer — settingSources [] does not change, the prompt cache prefix
        // is not affected (settings is a separate layer). DO NOT APPLY to the advisor
        // (advisor turns are short, native compaction unnecessary + avoid cache prefix
        // divergence).
        ...(NATIVE_COMPACT && !isAdvisor
          ? {
              settings: {
                autoCompactEnabled: true,
                // Fix 153: autoCompactWindow is set STANDING (every turn) — sonnet 190k /
                // opus 850k (100k on a force turn). When left to the SDK default (Fix
                // 148c) the in-process passive compaction never triggered; an explicit
                // window is required to guarantee firing native within the SAME session
                // (session_id preserved = CC-identical).
                ...(effectiveCompactWindow !== undefined
                  ? { autoCompactWindow: effectiveCompactWindow }
                  : {}),
              } as never,
            }
          : {}),
      });

    // OFF (default): per-turn query — teardown at the result (old behavior).
    // ON (PERSIST): persistent conn — the query stays ALIVE across turns, the bg
    // specialist keeps working, task_notification -> the host enqueues a resume on the
    // SAME session. stream = this turn's PushQueue; the existing for-await loop (below)
    // consumes it unchanged.
    let stream: AsyncIterable<SDKMessage>;
    let persistMode = false;
    const offResume = chief.getSessionIdFor(sid) && !resetSession
      ? chief.getSessionIdFor(sid)!
      : undefined;
    if (persistEligible && sessionQueryMgr) {
      persistMode = true;
      // /clear or transient retry (resetSession) -> close the old conn, open fresh.
      if (resetSession) sessionQueryMgr.closeConn(sid, "reset");
      // Structural signature — if it changes the conn is recreated (load_toolset / model
      // / effort / /compact / new specialist / memory). Otherwise reuse the live conn.
      const agentKeys = registry.list().map((s) => s.name).sort().join(",");
      const signature = JSON.stringify({
        sp: systemPromptStr,
        model: toApiModel(sessionModel),
        think: EFFORT_THINKING[effectiveEffort],
        tools: [...allowedSet].sort(),
        mcp: Object.keys(extraMcp).sort(),
        agentKeys,
        cwd: projectRoot,
      });
      const conn = sessionQueryMgr.acquireConn(sid, signature, (input, abort) =>
        query({
          prompt: input as never,
          options: makeOptions({ abort, resume: offResume }),
        }),
      );
      stream = sessionQueryMgr.beginTurnStream(sid) as AsyncIterable<SDKMessage>;
      // Push this turn's user message to the persistent input (string or text+image
      // content blocks). The queryPrompt async-gen is not used in ON mode.
      const pushContent = resimler.length
        ? [
            { type: "text" as const, text: effectivePrompt },
            ...resimler.map((r) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: r.mediaType ?? "image/png",
                data: r.veri,
              },
            })),
          ]
        : effectivePrompt;
      const userMsgForPush = {
        type: "user" as const,
        parent_tool_use_id: null,
        message: { role: "user" as const, content: pushContent },
      } as unknown as SDKUserMessage;
      sessionQueryMgr.pushInput(sid, userMsgForPush);
      // P1.33: register the active query by sid (pause/stop target). In ON mode
      // conn.query + conn.abortController.
      pauseTracker.setActiveQuery(sid, conn.query, conn.abortController);
    } else {
      const q = query({
        prompt: queryPrompt as never,
        options: makeOptions({ abort: abortController, resume: offResume }),
      });
      stream = q;
      // Fix STOP-2: also register the abortController — for stop/pause hard-abort.
      pauseTracker.setActiveQuery(sid, q, abortController);
    }
    // Send interrupt to the correct target in both modes: OFF -> query; ON -> conn.query.
    const interruptActive = (): void => {
      try {
        const q = persistMode
          ? sessionQueryMgr?.getConn(sid)?.query
          : (stream as unknown as { interrupt?: () => Promise<void> });
        q?.interrupt?.().catch(() => {});
      } catch {
        /* ignore */
      }
    };
    // Fix 60b: send a fresh runningSessions snapshot to the UI — so the optimistic flag
    // clears quickly.
    pushStatus();

    let reply = "";
    let gotResult = false;
    let transient = false;
    // M1: true on "error_during_execution" turns that appear subtype=success but are 0/0
    // in-out. runCommand prints this to the chatLog as a fail note and returns the
    // autonomousFail flag to the UI.
    let autonomousFail = false;
    // M2: if the resume is rejected we write the reason here (session_expired |
    // concurrent_use | manual_clear | transient_retry | unknown).
    let resumeLostReason: string | null = null;
    // Tokens accumulated during execution — shown live in the UI.
    let liveIn = 0;
    let liveOut = 0;
    // Fix 47: keep the in-turn context snapshot MAX-MONOTONIC. The per-msg snapshot comes
    // in different sizes on the SDK's first LLM call vs subsequent calls (the first call
    // is a small delta, then tool_result/history accumulates). Keep the highest snapshot
    // this turn saw → at the end of the turn it settles to the real turn-end size.
    // Monotonic WITHIN a turn (no flicker).
    // Fix 126: the OLD floor carried the previous turn's contextTokens CROSS-turn; once it
    // touched the 1.0M cap it NEVER dropped (after compact the real context was ~30k while
    // the bar stayed stuck at 100%). Solution: start each turn from 0 → the bar shows this
    // turn's REAL peak-call size (grows with history, drops after compact). contextTokens
    // is written to this real value at the end of the turn; auto-compact also sees the
    // correct number.
    let turContextMax = 0;
    // Cache-aware breakdown (PROMPT 10). Taken from the latest SDK message (cumulative
    // max — like input_tokens, the turn's total value).
    let liveCacheRead = 0;
    let liveCacheCreate = 0; // the SDK gives a single field; whether 1h or 5m depends on the proxy beta header
    let liveUncached = 0;
    let liveModel = sessionModel;
    // The command's in/out cost — filled from result.usage.
    let costIn = 0;
    let costOut = 0;
    let costCacheRead = 0;
    let costCacheCreate = 0;
    let costUncached = 0;
    // The tools the chief ran — shown in the UI.
    const toolMap = new Map<string, ToolActivity>();
    // Specialist chat record: when the chief spawns a registry specialist via the native
    // `Agent`/`Task` tool, capture the delegation (task prompt), and when tool_result
    // arrives write it together with the result to the specialist's persistent chat via
    // registry.appendChat. So when the user clicks the specialist in the UI they see the
    // task the chief sent + the specialist's reply (read-only). Map: Agent tool_use id ->
    // specialist name + task text.
    const agentDelegations = new Map<string, { specialist: string; task: string }>();
    // Fix 155: per-subagent REAL usage, keyed by the owner Agent tool_use id. The
    // subagent runs on ITS OWN model (e.g. sonnet) inside an isolated context; its
    // usage is NOT in the parent result.usage. Previously the Agent card showed the
    // PARENT's (chief/opus) round delta, making specialists look like they ran on the
    // chief's expensive model. Here we accumulate the subagent's own usage (input =
    // max, output = sum) and price it with the subagent's own model slug.
    const subUsage = new Map<string, { uc: number; cr: number; cc: number; out: number }>();
    // Fix 138 (C): a guard to start delege_arkaplan tool_use's only once (so the job does
    // not start twice if the same tool_use id appears in multiple messages).
    const bgJobStarted = new Set<string>();
    // Fix 141 (live input): in the native Agent tool, WHILE the specialist runs the parent
    // assistant message (carrying the full input) does NOT arrive; only
    // content_block_start (name present, input ABSENT) arrives -> input empty ->
    // SubagentInline shows "Agent". Solution: accumulate the input_json_delta pieces from
    // the stream by block index, and on each piece stream via onAktiviteIO("girdi") ->
    // SubagentInline pulls subagent_type LIVE from the raw string via regex. index ->
    // { tool id, accumulated JSON }.
    const toolInputBuf = new Map<number, { id: string; buf: string; last?: string }>();
    // Fix 56: per-tool token attribution. The SDK returns cumulative usage on each LLM
    // round; the delta between an assistant message with a tool_use and the next assistant
    // message = the "round cost" of that round's tools.
    // pendingToolIds: the tool_use's triggered in the current assistant msg. When the next
    // assistant msg arrives the delta is computed and written to their tokens, the list is
    // reset.
    let lastRoundSnap: {
      cacheRead: number;
      cacheCreate: number;
      uncached: number;
      output: number;
    } | null = null;
    let pendingToolIds: string[] = [];
    // Items 2 & 3: this turn we count each batch containing a tool_use within an assistant
    // message as one "round". If there are 5 tools in the same assistant message that is
    // 1 round / 5 tools — high efficiency. Sequential single-tool calls are rounds=tools.
    let roundCountTurn = 0;
    // Time-ordered segments — to keep the correct order between text blocks and tool
    // batches and show them inline Claude Code style in the UI. During the stream a
    // text_delta grows the latest "text" segment; a tool_use start opens a new "tools"
    // segment (or appends to the last "tools" segment). If the same id arrives twice it is
    // skipped.
    const segments: ChatSegment[] = [];
    // To keep the ToolActivity reference in toolMap shared with the tool inside segments,
    // we push the same object — result/error writes are already reflected through toolMap.
    const toolToSegment = new Map<string, ToolActivity>();
    // Item 5: true if the chief text streams live via stream_event text_delta. In that
    // case the "final reply" at the end of the result message is not pushed to segments
    // again (would be double display). If false — if no partial came — old behavior: the
    // msg.result text block is appended to the last segment.
    let streamedText = false;
    // Inline images collected from tool results (e.g. generate_image) — written to the
    // images field of the chief message in the UI.
    const collectedImages: string[] = [];
    // Fix 128: subagent (native Agent tool) live progress. The subagent text/tool activity
    // coming via forwardSubagentText arrives tagged with parent_tool_use_id.
    // parent_tool_use_id = the id of the owner Agent tool. We collect this text and stream
    // it to that Agent tool with the "ilerleme" ioKind — the SubagentInline card shows live
    // steps/text instead of "Thinking". Throttle: send consecutive emits for the same id
    // once per 400ms (UI flood + ws bandwidth).
    const subIlerleme = new Map<string, string>();
    const subEmitTs = new Map<string, number>();
    function pushSubProgress(parentId: string, parca: string): void {
      if (!parca) return;
      const onceki = subIlerleme.get(parentId) ?? "";
      // Keep the last ~4000 chars — the card preview shows a short tail, but the
      // expandable activity panel (SubagentInline) renders the full retained trail
      // (step-by-step tools + text the specialist produces live). Capped so it does
      // not grow unbounded over a long subagent run.
      let yeni = onceki + parca;
      if (yeni.length > 4000) yeni = yeni.slice(-4000);
      subIlerleme.set(parentId, yeni);
      const now = Date.now();
      const last = subEmitTs.get(parentId) ?? 0;
      if (now - last < 400) return;
      subEmitTs.set(parentId, now);
      onAktiviteIO?.(parentId, "ilerleme", yeni);
    }
    function pushTextDelta(delta: string): void {
      const last = segments[segments.length - 1];
      if (last && last.kind === "text") {
        last.text += delta;
      } else {
        segments.push({ kind: "text", text: delta });
      }
    }
    function pushToolStart(id: string, tool: ToolActivity): void {
      if (toolToSegment.has(id)) return;
      toolToSegment.set(id, tool);
      const last = segments[segments.length - 1];
      if (last && last.kind === "tools") {
        last.tools.push(tool);
      } else {
        segments.push({ kind: "tools", tools: [tool] });
      }
    }
    // Fix 121: incrementally write the accumulating half-turn to disk during streaming.
    // Purpose: if the orchestrator rebuilds/crashes mid-turn, the partial text + tool
    // activity that streamed to the screen stays in chat.json → shows on reload (Claude
    // Code logic: what is on screen is durable). On the normal/stop/pause paths runCommand
    // already pushes the final entry + clears this draft via clearLiveDraftFor, no double
    // display. 1.5s throttle to avoid disk thrash.
    // role: "sef" — SessionStore uses "sef" for all assistant roles (architect/chief/
    // advisor) (see the runCommand pushChatFor calls).
    let lastDraftWrite = 0;
    function persistLiveDraft(force = false): void {
      const now = Date.now();
      if (!force && now - lastDraftWrite < 1500) return;
      // If there is no meaningful content (no text/tool yet) do not write a draft.
      const draftText = segments
        .map((s) => (s.kind === "text" ? s.text : ""))
        .join("");
      if (!draftText.trim() && toolMap.size === 0) return;
      lastDraftWrite = now;
      try {
        chief.upsertLiveDraftFor(sid, {
          role: "sef",
          text: draftText,
          ts: now,
          segments: segments as never,
          aktivite: [...toolMap.values()] as never,
        });
      } catch {
        /* disk write best-effort — do not break the turn */
      }
    }
    // Cut a hung query — IDLE timeout: if the chief produces NO message/activity for a
    // certain time (the subprocess died) cut it. Long but actively running tasks (ssh,
    // jq, multi-step) are not cut by this.
    const IDLE_MS = 300000; // 5 min of inactivity
    let zamanAsimi = false;
    let sonMsg = Date.now();
    // Tool in flight — while a tool is running (tool_use sent, tool_result not returned)
    // the chief is not counted as "idle"; a worker/advisor sub-query can take minutes, the
    // idle check should not wrongly cut it.
    const pending = new Set<string>();
    let watch: ReturnType<typeof setInterval> | null = null;
    // Fix 120: did we exit the stream loop before it truly completed (gotResult)?
    // (stop/pause break or exception). For the hard-teardown in finally.
    let stoppedMidStream = false;
    // Fix 136: after the result message is PROCESSED, break the for-await IMMEDIATELY. The
    // SDK iterator sometimes does NOT CLOSE after `result` (streaming-input/persistent mode
    // or a buffered event) -> the for-await hangs on an infinite await -> the consume
    // promise never resolves -> runChiefAttempt NEVER RETURNS. Result (Fix 120 family):
    //   (a) the per-session runner stays stuck in queue.runningSessions -> the next queued
    //       message is NOT PROCESSED (the user waits "IN QUEUE", appears frozen),
    //   (b) tur_bitti/running=[] goes out late -> no UI "Thinking" indicator but work runs
    //       in the background (text/tool keeps being added to the same block).
    // result is the terminal message; nothing meaningful follows. break -> the finally
    // hard-teardown (interrupt+abort) closes the subprocess, the runner returns instantly.
    let brokeAfterResult = false;
    try {
      const tuket = (async () => {
      for await (const msg of stream) {
        // Fix STOP-3: after interrupt/abort the SDK may send buffered messages
        // (text_delta, tool_use). These give the UI a "the bubble is re-forming" /
        // "stop is not stopping" feel. If stop or pause is flagged, break the loop
        // immediately — buffered deltas are not emitted.
        // Fix 120: exiting via break does NOT SILENCE the SDK subprocess (it only stops
        // reading on this side). Mark the mid-stream exit so the hard-teardown fires in
        // finally.
        if (pauseTracker.isStoppedFor(sid) || pauseTracker.isPausedFor(sid)) {
          stoppedMidStream = true;
          break;
        }
        sonMsg = Date.now();
        if (msg.type === "stream_event") {
          const ev = (
            msg as {
              event?: {
                type?: string;
                index?: number;
                delta?: { type?: string; text?: string; partial_json?: string };
                content_block?: { type?: string; id?: string; name?: string };
              };
            }
          ).event;
          // Fix 128: a subagent partial message (forwardSubagentText) carries
          // parent_tool_use_id. These text/tool deltas are NOT the PARENT's text/tool
          // list — route them to the owner Agent card as progress, do not pollute the
          // parent stream.
          const subParentId = (
            msg as { parent_tool_use_id?: string | null }
          ).parent_tool_use_id;
          if (subParentId) {
            if (
              ev?.type === "content_block_delta" &&
              ev.delta?.type === "text_delta" &&
              ev.delta.text
            ) {
              pushSubProgress(subParentId, ev.delta.text);
            } else if (
              ev?.type === "content_block_start" &&
              ev.content_block?.type === "tool_use"
            ) {
              // The subagent called a tool — show a "→ <tool>" step hint on the card.
              const tad = String(ev.content_block.name ?? "tool");
              pushSubProgress(subParentId, `\n→ ${tad}\n`);
            }
            continue;
          }
          if (
            ev?.type === "content_block_delta" &&
            ev.delta?.type === "text_delta" &&
            ev.delta.text
          ) {
            pushTextDelta(ev.delta.text);
            streamedText = true;
            onDelta?.(ev.delta.text);
            // Fix 121: partial text to disk (throttled). So it survives rebuild/crash.
            persistLiveDraft();
          } else if (
            ev?.type === "content_block_start" &&
            ev.content_block?.type === "tool_use" &&
            ev.content_block.id
          ) {
            // Capture the tool event INSTANTLY — the moment the model starts producing
            // the tool_use block. Do not wait for the turn end (assistant message).
            const id = ev.content_block.id;
            const ad = String(ev.content_block.name ?? "tool");
            // Fix 141: map index -> id to accumulate this block's input (input_json_delta).
            // So the input fills LIVE (the Agent card name is instant).
            if (typeof ev.index === "number") {
              toolInputBuf.set(ev.index, { id, buf: "" });
            }
            if (!toolMap.has(id)) {
              const tool: ToolActivity = { id, ad, girdi: "", sonuc: "", hata: false };
              toolMap.set(id, tool);
              pushToolStart(id, tool);
              pending.add(id);
              onAktivite?.(id, ad, "calisiyor");
              // Fix 121: tool activity is also part of the half-turn — write to disk.
              persistLiveDraft();
            }
          } else if (
            ev?.type === "content_block_delta" &&
            ev.delta?.type === "input_json_delta" &&
            typeof ev.index === "number" &&
            ev.delta.partial_json
          ) {
            // Fix 141: the tool input streams piece by piece (partial_json). Accumulate +
            // stream the input to the UI on each piece. SubagentInline pulls subagent_type
            // from the truncated/partial JSON via regex -> the Agent card name is LIVE.
            const slot = toolInputBuf.get(ev.index);
            if (slot) {
              slot.buf += ev.delta.partial_json;
              const g = kisalt(slot.buf);
              // Dedupe: once kisalt passes 280 g stabilizes; do not resend the same value,
              // preventing WS spam (~20+ identical events).
              if (g !== slot.last) {
                slot.last = g;
                if (toolMap.has(slot.id)) toolMap.get(slot.id)!.girdi = g;
                onAktiviteIO?.(slot.id, "girdi", g);
              }
            }
          }
        } else if (msg.type === "assistant") {
          // Subagent (Task tool) messages come through the stream but their usage is NOT
          // in result.usage — do not count them, otherwise live > final.
          const isSubagent =
            (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id !=
            null;
          // Turn usage — stream the token counter live during execution.
          const u = (
            msg as {
              message?: {
                content?: unknown[];
                usage?: {
                  input_tokens?: number;
                  output_tokens?: number;
                  cache_creation_input_tokens?: number;
                  cache_read_input_tokens?: number;
                };
              };
            }
          ).message?.usage;
          if (u && !isSubagent) {
            // Important: each intermediate assistant message's input_tokens is the total
            // prompt size of THAT call (the whole context of previous turns). If we sum
            // them we count the same input multiple times; final result.usage <<< live
            // (bug). Since final result.usage.input_tokens equals the prompt of the last
            // (fattest) call, taking the "max" matches the final exactly.
            const turIn =
              (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
            if (turIn > liveIn) liveIn = turIn;
            // Cache-aware breakdown — same logic (max), consistent with final.
            const cr = u.cache_read_input_tokens ?? 0;
            const cc = u.cache_creation_input_tokens ?? 0;
            const uc = u.input_tokens ?? 0;
            if (cr > liveCacheRead) liveCacheRead = cr;
            if (cc > liveCacheCreate) liveCacheCreate = cc;
            if (uc > liveUncached) liveUncached = uc;
            // Output is new on each LLM call — accumulation is correct.
            liveOut += u.output_tokens ?? 0;

            // Fix 56: per-tool token attribution. delta to the previous round's pending
            // tools = this_round_usage - last_snap. If a shared round has multiple tools
            // the same delta is written to all of them (per round).
            if (lastRoundSnap && pendingToolIds.length > 0) {
              const dCacheCreate = Math.max(0, liveCacheCreate - lastRoundSnap.cacheCreate);
              const dCacheRead = Math.max(0, liveCacheRead - lastRoundSnap.cacheRead);
              const dUncached = Math.max(0, liveUncached - lastRoundSnap.uncached);
              const dOutput = Math.max(0, liveOut - lastRoundSnap.output);
              // USD estimate: round cost
              const dPrice = priceForModel(liveModel, {
                is1m: isOpus(sessionModel),
                totalContext: liveUncached + liveCacheRead + liveCacheCreate,
              });
              // Fix 102: cache_create default 5m.
              const dCchIs1h = (process.env.ARCHITECT_CACHE_1H === "1" || process.env.ARCHITECT_CCH_MOVE === "1");
              const dUsd = estimateCost(
                {
                  uncachedInput: dUncached,
                  cacheRead: dCacheRead,
                  cacheCreate1h: dCchIs1h ? dCacheCreate : 0,
                  cacheCreate5m: dCchIs1h ? 0 : dCacheCreate,
                  output: dOutput,
                },
                dPrice,
              );
              for (const id of pendingToolIds) {
                const t = toolMap.get(id);
                if (t) {
                  // Fix 155: Agent/Task subagent tools are priced from their OWN model
                  // usage (see the isSubagent usage branch), NOT the parent round delta.
                  // Skip them here so the chief/opus delta does not overwrite the real
                  // specialist cost.
                  if (t.ad === "Agent" || t.ad === "Task") continue;
                  t.tokens = {
                    in: dUncached + dCacheCreate,
                    out: dOutput,
                    cacheRead: dCacheRead,
                    cacheCreate: dCacheCreate,
                    usd: dUsd,
                  };
                  // Fix 62: notify the UI of the per-tool token delta — so the mid-stream
                  // badge shows.
                  onAktiviteTokens?.(id, t.tokens);
                }
              }
              pendingToolIds = [];
            }
            // Current round snapshot — for the delta in the next assistant msg.
            lastRoundSnap = {
              cacheRead: liveCacheRead,
              cacheCreate: liveCacheCreate,
              uncached: liveUncached,
              output: liveOut,
            };
            // Model name — reflects the model's real slug from the SDK message.
            const m = (
              msg as { message?: { model?: string } }
            ).message?.model;
            if (m) liveModel = m;
            // Context fullness — this turn's instantaneous prompt size (not a sum).
            // Fix 47: MAX-MONOTONIC to avoid in-turn fluctuation. The per-msg snapshot
            // comes small on the SDK's first LLM call (e.g. only a delta); it grows on
            // subsequent calls. The UI bar shows this fluctuation like 80→60→76 →
            // confusing. With max the largest observation is always shown; when the turn
            // ends the final result snapshot settles turContextMax to a fixed final value.
            // Fix 57: output_tokens is not included — this call's output does NOT occupy
            // space in THIS call's context window (it goes to the next turn's input). Only
            // input + cache_read + cache_create = peak input prompt size. Correct as a
            // window-fullness measure.
            const rawSnapshot =
              (u.input_tokens ?? 0) +
              (u.cache_read_input_tokens ?? 0) +
              (u.cache_creation_input_tokens ?? 0);
            if (rawSnapshot > turContextMax) turContextMax = rawSnapshot;
            const contextSnapshot = turContextMax;
            // Live $ estimate — based on the model price. Whether cache_creation is 5m or
            // 1h, the proxy beta header adds 1h, so we count 1h.
            // PRICING CORRECTION: if chiefModel contains [1m] the beta header is sent; but
            // the 2x rate applies ONLY when total context >200k. We lose this in the
            // liveModel SDK message — we read it from chiefModel.
            const totalCtxLive =
              liveUncached + liveCacheRead + liveCacheCreate;
            const price = priceForModel(liveModel, {
              is1m: isOpus(sessionModel),
              totalContext: totalCtxLive,
            });
            // Fix 102: cache_create default 5m (proxy 1h header opt-in).
            const liveCchIs1h = (process.env.ARCHITECT_CACHE_1H === "1" || process.env.ARCHITECT_CCH_MOVE === "1");
            const liveUsd = estimateCost(
              {
                uncachedInput: liveUncached,
                cacheRead: liveCacheRead,
                cacheCreate1h: liveCchIs1h ? liveCacheCreate : 0,
                cacheCreate5m: liveCchIs1h ? 0 : liveCacheCreate,
                output: liveOut,
              },
              price,
            );
            onToken?.(liveIn, liveOut, contextSnapshot, {
              cacheRead: liveCacheRead,
              cacheCreate: liveCacheCreate,
              uncached: liveUncached,
              usd: liveUsd,
              model: liveModel,
            });
          } else if (u && isSubagent) {
            // Fix 155: attribute the subagent's REAL usage (its OWN model) to the
            // owner Agent tool card. The subagent message carries its own model slug
            // (proof it ran on the assigned model, e.g. sonnet, not the chief's opus).
            // Without this the card showed the parent opus round delta → specialists
            // looked like they ran on the chief's model + cost.
            const subParentId = (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id;
            const subModel = (msg as { message?: { model?: string } }).message?.model || "";
            if (subParentId) {
              const acc = subUsage.get(subParentId) ?? { uc: 0, cr: 0, cc: 0, out: 0 };
              // input_tokens is the cumulative prompt of THAT subagent call → max;
              // output is new per call → sum (same rule as the parent accounting).
              acc.uc = Math.max(acc.uc, u.input_tokens ?? 0);
              acc.cr = Math.max(acc.cr, u.cache_read_input_tokens ?? 0);
              acc.cc = Math.max(acc.cc, u.cache_creation_input_tokens ?? 0);
              acc.out += u.output_tokens ?? 0;
              subUsage.set(subParentId, acc);
              const t = toolMap.get(subParentId);
              if (t && subModel) {
                const sp = priceForModel(subModel, {
                  is1m: isOpus(subModel),
                  totalContext: acc.uc + acc.cr + acc.cc,
                });
                const subCch1h = (process.env.ARCHITECT_CACHE_1H === "1" || process.env.ARCHITECT_CCH_MOVE === "1");
                const subUsd = estimateCost(
                  {
                    uncachedInput: acc.uc,
                    cacheRead: acc.cr,
                    cacheCreate1h: subCch1h ? acc.cc : 0,
                    cacheCreate5m: subCch1h ? 0 : acc.cc,
                    output: acc.out,
                  },
                  sp,
                );
                t.tokens = {
                  in: acc.uc + acc.cc,
                  out: acc.out,
                  cacheRead: acc.cr,
                  cacheCreate: acc.cc,
                  usd: subUsd,
                };
                onAktiviteTokens?.(subParentId, t.tokens);
              }
            }
          }
          // Fill in the tool_use input detail (the instant event already passed).
          const content = (msg as { message?: { content?: unknown[] } }).message?.content;
          // Fix 128: subagent assistant message — the tool_use/text inside does NOT enter
          // the PARENT's tool list (the old behavior added them as loose tools, showing as
          // standalone lines instead of a card). Instead reflect it as progress text onto
          // the owner Agent card.
          if (isSubagent) {
            const subParentId = (
              msg as { parent_tool_use_id?: string | null }
            ).parent_tool_use_id;
            if (subParentId && Array.isArray(content)) {
              for (const b of content as Array<Record<string, unknown>>) {
                if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
                  pushSubProgress(subParentId, b.text);
                } else if (b.type === "tool_use") {
                  pushSubProgress(subParentId, `\n→ ${String(b.name ?? "tool")}\n`);
                }
              }
            }
          } else if (Array.isArray(content)) {
            // Item 3: if this assistant message contains >=1 tool_use it is 1 round.
            // Parallel tools come in the same message — multiple tools is 1 round.
            let bestToolInMsg = false;
            for (const b of content as Array<Record<string, unknown>>) {
              if (b.type === "tool_use" && typeof b.id === "string") {
                const ad = String(b.name ?? "tool");
                const girdi = kisalt(JSON.stringify(b.input ?? {}));
                const existing = toolMap.get(b.id);
                if (existing) {
                  existing.girdi = girdi;
                  // Fix 93: if the input filled in later, reflect to the UI.
                  onAktiviteIO?.(b.id, "girdi", girdi);
                } else {
                  const tool: ToolActivity = { id: b.id, ad, girdi, sonuc: "", hata: false };
                  toolMap.set(b.id, tool);
                  pushToolStart(b.id, tool);
                  pending.add(b.id);
                  onAktivite?.(b.id, ad, "calisiyor");
                  // Fix 93: instant input to the UI when the tool starts.
                  onAktiviteIO?.(b.id, "girdi", girdi);
                  bestToolInMsg = true;
                }
                // Fix 56: this tool_use will get cost attribution in the next round.
                pendingToolIds.push(b.id);
                // Specialist delegation capture: if subagent_type in an Agent/Task
                // tool_use is a registry specialist, store the task prompt (appendChat
                // with the result at tool_result). Built-in subagents (Explore etc.) are
                // NOT in the registry → skipped, only real specialists are recorded.
                if ((ad === "Agent" || ad === "Task") && b.input && typeof b.input === "object") {
                  const inp = b.input as { subagent_type?: unknown; prompt?: unknown; description?: unknown };
                  const sub = typeof inp.subagent_type === "string" ? inp.subagent_type : "";
                  if (sub && registry.get(sub)) {
                    const task =
                      (typeof inp.prompt === "string" && inp.prompt) ||
                      (typeof inp.description === "string" && inp.description) ||
                      "";
                    agentDelegations.set(b.id, { specialist: sub, task });
                    // Fix: native Agent/Task delegation now drives the left-sidebar
                    // status dot too. Previously only the explicit delegate_to_specialist
                    // tool emitted delege_basladi/bitti, so specialists invoked via the
                    // native Agent tool showed "Idle" in the sidebar even while running.
                    emit("delege_basladi", { agent: sub, task });
                    // Write the task to the specialist's persistent chat IMMEDIATELY (at
                    // tool_use time) — so WHILE the specialist runs (without waiting for
                    // tool_result) the modal shows "task assigned + running". The result
                    // is also added at tool_result. The UI updates instantly via
                    // refreshStatus.
                    try {
                      registry.appendChat(sub, {
                        role: "ajan_komut",
                        text: task,
                        ts: Date.now(),
                        fromAgent: projectName,
                      });
                      pushStatus();
                    } catch { /* registry write is not critical */ }
                    // Fix 138: if called with background:true, mark bg on the persistent
                    // conn. When task_notification arrives the host enqueues a resume turn
                    // on the SAME session (the chief wakes up and acts on the result). A
                    // foreground (background!==true) delegation flows normal blocking.
                    if (
                      persistMode &&
                      (b.input as { background?: unknown }).background === true
                    ) {
                      sessionQueryMgr?.markBackground(sid, b.id, sub);
                    }
                  }
                }
                // Fix 138 (C): delege_arkaplan tool_use -> start the specialist in the
                // background. sid is in scope here (the tool has none). The specialist
                // runs in an independent query; when done main.ts enqueues a resume turn
                // on the SAME session. Guard: do not start the same id twice.
                if (
                  ASYNC_DELEGE &&
                  ad === "delege_arkaplan" &&
                  b.input &&
                  typeof b.input === "object" &&
                  !bgJobStarted.has(b.id)
                ) {
                  const inp = b.input as { uzman?: unknown; gorev?: unknown };
                  const uz = typeof inp.uzman === "string" ? inp.uzman : "";
                  const gv = typeof inp.gorev === "string" ? inp.gorev : "";
                  if (uz && gv) {
                    bgJobStarted.add(b.id);
                    const jid = bgJobManager!.startJob(sid, uz, gv);
                    logger.info("async_delege_baslatildi", { sid, uzman: uz, jobId: jid });
                  }
                }
              }
            }
            if (bestToolInMsg && !isSubagent) roundCountTurn += 1;
          }
        } else if (msg.type === "user") {
          // Match the tool_result blocks.
          const content = (msg as { message?: { content?: unknown } }).message?.content;
          if (Array.isArray(content)) {
            for (const b of content as Array<Record<string, unknown>>) {
              if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
                const t = toolMap.get(b.tool_use_id);
                if (t) {
                  const c = b.content;
                  // Capture inline images: transfer the image blocks inside tool_result to
                  // the images field of the chat message.
                  if (Array.isArray(c)) {
                    for (const x of c as Array<Record<string, unknown>>) {
                      if (
                        x &&
                        typeof x === "object" &&
                        x.type === "image" &&
                        typeof x.data === "string"
                      ) {
                        const mt =
                          (typeof x.mimeType === "string" && x.mimeType) ||
                          (typeof (x as { media_type?: unknown }).media_type ===
                            "string" &&
                            (x as { media_type: string }).media_type) ||
                          "image/png";
                        collectedImages.push(`data:${mt};base64,${x.data}`);
                      }
                    }
                  }
                  t.sonuc = kisalt(
                    typeof c === "string"
                      ? c
                      : Array.isArray(c)
                        ? c
                            .map((x) =>
                              x && typeof x === "object" && "text" in x
                                ? String((x as { text: unknown }).text)
                                : "",
                            )
                            .join(" ")
                        : JSON.stringify(c ?? ""),
                  );
                  t.hata = b.is_error === true;
                  pending.delete(b.tool_use_id);
                  onAktivite?.(b.tool_use_id, t.ad, t.hata ? "hata" : "bitti");
                  // Fix 93: result mid-stream to the UI.
                  onAktiviteIO?.(b.tool_use_id, "sonuc", t.sonuc, t.hata);
                  // Specialist chat record: if this tool_result belongs to an Agent
                  // delegation, write the chief's task + the specialist's result to the
                  // specialist's persistent chat (for the read-only UI view). One-shot —
                  // deleted from the id map.
                  const deleg = agentDelegations.get(b.tool_use_id);
                  if (deleg) {
                    agentDelegations.delete(b.tool_use_id);
                    // Fix 160: a BACKGROUND (fire-and-forget) Agent call returns an
                    // immediate launch acknowledgement ("Async agent launched
                    // successfully. agentId: ...") — this is NOT the specialist's
                    // result and must not be written to its chat as a "uzman" reply
                    // (it leaks the internal agentId + SendMessage instruction). The
                    // REAL result arrives later via handleBgComplete (task_notification).
                    // The specialist is also still RUNNING, so do NOT flip the sidebar
                    // dot to idle here.
                    const isBgLaunchAck = /async agent launched/i.test(t.sonuc ?? "");
                    if (!isBgLaunchAck) {
                      // Sidebar status dot: native Agent delegation finished → back to
                      // idle (or error). Pairs with the delege_basladi at tool_use time.
                      emit("delege_bitti", { agent: deleg.specialist, isError: !!t.hata });
                      try {
                        // The task (ajan_komut) was ALREADY written at tool_use time;
                        // here only add the specialist's result.
                        registry.appendChat(deleg.specialist, {
                          role: "uzman",
                          text: t.sonuc,
                          ts: Date.now(),
                          hata: t.hata,
                        });
                        pushStatus();
                      } catch { /* registry write is not critical */ }
                    }
                  }
                  // Fix 121: write the tool result to the draft too.
                  persistLiveDraft();
                }
              }
            }
          }
        } else if (
          msg.type === "system" &&
          (msg as { subtype?: string }).subtype === "compact_boundary"
        ) {
          // Fix 148: the SDK native in-place compaction signal. It happened within the
          // SAME session (session_id preserved) — the exact opposite of our old "new
          // session" flow, identical to Claude Code. Here we ONLY observe + do an instant
          // context update; the SDK already managed the transcript + summary. setSessionIdFor
          // is done on the result turn (the session did not change).
          const cm =
            (msg as { compact_metadata?: Record<string, unknown> })
              .compact_metadata ?? {};
          const preTok = Number(cm.pre_tokens ?? 0);
          const postTok = Number(cm.post_tokens ?? 0);
          logger.info("native_compact_boundary", {
            sid,
            sessionId: (msg as { session_id?: string }).session_id,
            trigger: cm.trigger,
            pre: preTok,
            post: postTok,
            durationMs: cm.duration_ms,
          });
          // Instant UI feedback — let the context bar drop. The peak is recomputed on the
          // result turn; this is only so the compaction is visible.
          if (postTok > 0) chief.setContextFor(sid, postTok);
        } else if (msg.type === "result") {
          gotResult = true;
          const sefIn = msg.usage.input_tokens + msg.usage.cache_creation_input_tokens;
          costIn = sefIn;
          costOut = msg.usage.output_tokens;
          // Cache-aware breakdown — carried to sef_cevap.cost to show the user $ and the
          // cache hit ratio. THESE VALUES ARE CUMULATIVE (the SUM of all the turn's LLM
          // calls). Correct for billing but NOT for CONTEXT WINDOW FULLNESS.
          costCacheRead = msg.usage.cache_read_input_tokens ?? 0;
          costCacheCreate = msg.usage.cache_creation_input_tokens ?? 0;
          costUncached = msg.usage.input_tokens ?? 0;
          // Fix 57 CRITICAL: the OLD logic finalCtx = uncached + cacheRead + cacheCreate +
          // output → since result.usage is CUMULATIVE, in a 5-LLM-call turn 5x200k
          // cache_read = 1M was shown. With a Sonnet 200k window the UI showed 500%+.
          // Solution: do not derive context from result.usage. Keep only the live
          // (per-message) max. liveUncached + liveCacheRead + liveCacheCreate = the
          // largest SINGLE LLM CALL prompt size this turn saw. Output is not in this
          // call's context (it goes to the next turn's input).
          const peakCallInput = liveUncached + liveCacheRead + liveCacheCreate;
          if (peakCallInput > turContextMax) turContextMax = peakCallInput;
          // Sonnet/Haiku 200k / Opus 1M window — apply a reasonable upper limit instead of
          // a backend cap. Even if the SDK compacts internally the UI stays informative.
          const windowMax = isOpus(sessionModel) ? 1_000_000 : 200_000;
          if (turContextMax > windowMax) turContextMax = windowMax;
          onToken?.(liveIn, liveOut, turContextMax, {
            cacheRead: costCacheRead,
            cacheCreate: costCacheCreate,
            uncached: costUncached,
            usd: 0,
            model: liveModel,
          });
          usage.record("sef", { input: sefIn, output: msg.usage.output_tokens });
          emit("token_guncelleme", {
            agent: "sef",
            input: sefIn,
            output: msg.usage.output_tokens,
          });
          if (usage.overBudget()) {
            emit("hata", { mesaj: "Daily token budget threshold exceeded." });
          }
          if (msg.subtype === "success") {
            // M1: detect a turn that did not actually happen even though it appears
            // subtype=success. 0 in / 0 out + empty reply = the SDK went silent, no work
            // done — error_during_execution. Do not count it as "success"; mark transient,
            // trigger retry, return the autonomousFail flag.
            let reportedReply = msg.result ?? "";
            // So the Claude Code SDK internal "[ede_diagnostic] result_type=..." diagnostic
            // text is not sent as a reply — when a cap/limit is exceeded show the user a
            // clean message instead of the raw technical log. Log the raw text, trigger
            // retry.
            if (reportedReply.startsWith("[ede_diagnostic]")) {
              logger.error("sdk_ede_diagnostic", {
                sessionId: msg.session_id,
                raw: reportedReply.slice(0, 400),
              });
              const budgetMatch = reportedReply.match(/maliyet asildi.*?(\$[\d.]+\/\$?[\d.]+)/i);
              reportedReply = budgetMatch
                ? `Turn cost limit exceeded (${budgetMatch[1]}). Waiting for a new command.`
                : "Claude Code internal diagnostic: the turn did not complete. Try again or split the command.";
              autonomousFail = true;
            }
            const isExecutionFailure =
              sefIn === 0 && msg.usage.output_tokens === 0 && !reportedReply.trim();
            if (isExecutionFailure) {
              transient = true;
              autonomousFail = true;
              reply = "[Turn failed: error_during_execution — 0 in/0 out]";
              logger.error("error_during_execution", {
                sessionId: msg.session_id,
                resumeRequested: resumeId,
                usage: msg.usage,
              });
              errorTracker.report("error_during_execution");
            } else if (isTransient(reportedReply)) {
              // C3: if subtype=success but the result contains a transient error like
              // "API Error..." / ConnectionRefused, it is not a real reply — the SDK's
              // fetch failed. Push it to a transient retry.
              transient = true;
              reply = reportedReply;
              logger.error("transient_in_success_reply", {
                sessionId: msg.session_id,
                reply: reply.slice(0, 200),
              });
              errorTracker.report(reply);
            } else {
              // Save session_id only from a successful turn — resuming a corrupted turn's
              // session_id gives 400 "tool use concurrency".
              chief.setSessionIdFor(sid, msg.session_id);
              state.lastChiefTurnTs = Date.now(); // cache TTL tracking
              reply = reportedReply;
              // Item 5: when includePartialMessages=true the text_delta's already streamed
              // into segments — do not push the final reply again (double display). Only
              // if stream_event gave no text at all (short turn, tool-only or cached reply)
              // append the final reply to the end of segments.
              if (!streamedText && reply && reply.trim()) {
                const lastSeg = segments[segments.length - 1];
                if (lastSeg && lastSeg.kind === "text") {
                  lastSeg.text += reply;
                } else {
                  segments.push({ kind: "text", text: reply });
                }
              }
              const resumeAccepted = !!resumeId && msg.session_id === resumeId;
              // M2: if the resume was rejected, write the reason. If the SDK could not
              // find the old session it returns with a new id — if there is a last clear
              // reason recorded in ChiefStore use it, otherwise "session_expired".
              if (!!resumeId && !resumeAccepted) {
                const clr = chief.getLastClearReasonFor(sid);
                // A clear within 60s means "manual/another reason".
                const yeniMi = clr.ts > 0 && Date.now() - clr.ts < 60_000;
                resumeLostReason = yeniMi && clr.reason ? clr.reason : "session_expired";
                logger.warn("resume_invalidate", {
                  resumeRequested: resumeId,
                  gotSession: msg.session_id,
                  sebep: resumeLostReason,
                });
              }
              logger.info("sef_query_basari", {
                replyUzunluk: reply.length,
                input: sefIn,
                output: msg.usage.output_tokens,
                sessionId: msg.session_id,
                resumeRequested: resumeId,
                resumeAccepted,
                yeniSessionMu: !!resumeId && !resumeAccepted,
                resumeLostReason: resumeLostReason ?? undefined,
              });
            }
          } else {
            reply = msg.errors.join("\n");
            if (isTransient(reply)) transient = true;
            // Log the full error detail — for 400 diagnosis.
            logger.error("sef_query_hata", {
              subtype: msg.subtype,
              errors: msg.errors,
              transient,
              usage: msg.usage,
              tamMesaj: JSON.stringify(msg).slice(0, 4000),
            });
            // Auto-rollback tracker — rolls back to last-good if a critical pattern (400
            // cache_control etc.) or 3+ of the same error within 5 min is detected.
            errorTracker.report(reply);
          }
          // Fix 136: result processed -> break the for-await IMMEDIATELY. Do not WAIT for
          // the SDK iterator to close itself (it may hang and lock the runner). The finally
          // hard-teardown (interrupt+abort) closes the subprocess.
          brokeAfterResult = true;
          break;
        }
      }
      })();
      const sayac = new Promise<never>((_, rej) => {
        watch = setInterval(() => {
          // If a tool is in flight the chief is working — do not count as idle.
          if (pending.size === 0 && Date.now() - sonMsg > IDLE_MS) {
            zamanAsimi = true;
            interruptActive();
            rej(new Error("idle timeout: the chief produced no activity for 5 min"));
          }
        }, 30000);
      });
      await Promise.race([tuket, sayac]);
    } catch (e) {
      const mesaj = (e as Error).message;
      logger.error("sef_query_exception", {
        mesaj,
        ad: (e as Error).name,
        stack: (e as Error).stack,
        gotResult,
        zamanAsimi,
      });
      // Auto-rollback tracker — critical patterns like module_not_found / type_error /
      // cache_control or repeating loops are caught here.
      errorTracker.report(mesaj);
      if (!gotResult) {
        reply = zamanAsimi
          ? "The chief produced no activity for 5 minutes — the operation was cancelled " +
            "(likely a hang). Try again."
          : `Chief run stopped with error: ${mesaj}`;
        // If retried, the timeout would happen again — do not count as transient.
        transient = zamanAsimi ? false : isTransient(mesaj);
      }
    } finally {
      if (watch) clearInterval(watch);
      // Fix 120: if we exited before the turn TRULY completed (stop/pause break,
      // exception, idle timeout or empty turn) the SDK subprocess may still be producing
      // — while the UI shows idle, it spawns "one session running in two places" in the
      // background. First interrupt + abort (best-effort, idempotent), THEN delete the
      // record. A normally completed turn (gotResult) does not enter this path.
      // Fix 136: brokeAfterResult also requires teardown — we broke the loop after the
      // result, the SDK iterator did not close itself, the subprocess may still be up.
      // Close it definitively with interrupt+abort (idempotent). A normal "natural close"
      // (iterator finished without a break) no longer happens; since every successful turn
      // breaks at the result, this path always tears down.
      if (persistMode) {
        // Fix 138: persistent conn — the turn ended, the conn stays ALIVE (bg specialist +
        // next turn). NO teardown on normal completion. stop/pause -> controlHandler
        // aborted the conn (killSession); idle-timeout -> interruptActive cut the turn (the
        // conn lives). Just close this turn's queue + delete the activeQuery record (so an
        // idle conn is not a pause target, and bg can continue).
        sessionQueryMgr?.endTurn(sid);
        pauseTracker.deleteActiveQuery(sid);
      } else {
        if (!gotResult || stoppedMidStream || brokeAfterResult) {
          interruptActive();
          pauseTracker.abortFor(sid);
        }
        pauseTracker.deleteActiveQuery(sid);
      }
      // Fix 121: delete the live draft. If finally ran, the process is UP → runCommand
      // takes the return value and will ALREADY push the final/stop/pause/partial entry.
      // If we leave the draft, the same content shows twice. A hard kill (rebuild) does
      // NOT RUN this finally → the draft stays on disk, a half bubble shows on reload (the
      // real purpose). Since all roles (chief/architect/advisor) go through this single
      // shared path, the fix covers all of them.
      try {
        chief.clearLiveDraftFor(sid);
      } catch {
        /* ignore */
      }
    }
    // Bug 3 fix: Empty-turn fallback. The stream ended completely without an exception
    // BUT no result came (gotResult=false) + reply is still empty → it silently fell
    // through "in 0 out 0". Old behavior: return the empty reply to runCommand and show
    // "Thinking 8s / no reply" in the UI. New: mark it transient, put a meaningful
    // message, let the retry path work. So on 0-token silent turns the user sees a real
    // error message or a retry result.
    if (!gotResult && !reply.trim()) {
      // Fix 150 (ROOT CAUSE — session being deleted): if the USER stopped (stop/pause) the
      // turn ends "empty" BUT this is NOT a CORRUPTED session — the user cut it on purpose.
      // The old code called clearSessionIdFor without distinction -> on stop + resume the
      // SDK session was deleted and the chief lost ALL context ("I could not understand").
      // It also set transient=true triggering retry and re-ran the stopped turn. Solution:
      // on user-interruption KEEP the session, NO retry.
      const userInterrupted =
        stoppedMidStream ||
        pauseTracker.isStoppedFor(sid) ||
        pauseTracker.isPausedFor(sid);
      if (userInterrupted) {
        transient = false;
        autonomousFail = false;
        reply = "[Turn stopped by the user — context preserved]";
        logger.info("user_stop_empty_turn", { sessionId: resumeId, liveIn, liveOut });
        // session is PRESERVED: the next command resumes the SAME conversation. If there
        // is a dangling tool_use risk, the next resume returns SDK 400 -> the transient
        // retry path does a one-shot clearSessionId at that point (the existing safety net).
      } else {
        transient = true;
        autonomousFail = true;
        reply = "[Turn fell through silently: the LLM call ended without a reply (0 in / 0 out). A retry will be triggered.]";
        logger.error("silent_empty_turn", {
          sessionId: resumeId,
          liveIn,
          liveOut,
        });
        errorTracker.report("silent_empty_turn");
        // Fix 145 (DUPLICATE ROOT): a REAL silent-empty (0/0, the user did not cut) usually
        // means a CORRUPTED session with a DANGLING tool_use. If resumed, the SDK
        // RE-EXECUTEs the dangling tool_use -> the chief REPEATS the same reply + delegates
        // the same specialist twice. So clear the session ONLY in this case.
        chief.clearSessionIdFor(sid, "silent_empty");
      }
    }
    // The turn was interrupted/got an exception (no gotResult) — the old behavior was to
    // delete the sessionId instantly, but this caused the Architect to lose all history on
    // the next turn after a rebuild/pause/network glitch. New behavior: keep the sessionId.
    // On the next call if the SDK rejects the resume (400 dangling tool_use) the transient
    // retry path ALREADY calls clearSessionId — the only lost usage is 1 extra retry.
    // Otherwise history is preserved.
    // if (!gotResult) chief.clearSessionId();  // DISABLED — see comment.
    // Orphan tool recovery: the turn closed but tool_result did not come for some tools
    // (pending is still populated). Do not show "running" forever in the UI — mark as
    // error, and give the model a half-plan signal too.
    const orphanedTools: string[] = [];
    for (const id of pending) {
      const t = toolMap.get(id);
      if (t) {
        t.hata = true;
        if (!t.sonuc) {
          t.sonuc = "(tool result did not return — the turn closed early)";
        }
        orphanedTools.push(t.ad);
        onAktivite?.(id, t.ad, "hata");
      }
    }
    if (orphanedTools.length) {
      logger.warn("orphaned_tool_recovery", {
        count: orphanedTools.length,
        tools: orphanedTools,
      });
    }
    const aktiviteFinal = [...toolMap.values()];
    // Tool usage telemetry — record all the turn's tool calls into statistics. Data for
    // the next turn's load_toolset decision + Architect revision.
    if (aktiviteFinal.length) {
      try {
        toolUsageStats.recordTurn(
          isGlobal ? "Mimar" : `ProjeSefi:${projectName}`,
          aktiviteFinal.map((t) => ({ ad: t.ad, hata: t.hata })),
        );
      } catch (e) {
        logger.warn("tool_usage_record_hata", { hata: (e as Error).message });
      }
      // Items 2 & 3: delegation ratio + batch efficiency telemetry.
      try {
        const kaynaklar = { sef: 0, delegate: 0, task: 0, spawn_worker: 0, other: 0 };
        for (const t of aktiviteFinal) {
          const k = kaynakBelirle(t.ad);
          kaynaklar[k] += 1;
        }
        const toolCount = aktiviteFinal.length;
        const roundCount = Math.max(roundCountTurn, 1);
        turnMetrics.record({
          agent: isGlobal ? "Mimar" : `ProjeSefi:${projectName}`,
          sef: kaynaklar.sef,
          delegate: kaynaklar.delegate,
          task: kaynaklar.task,
          spawn_worker: kaynaklar.spawn_worker,
          other: kaynaklar.other,
          tool_count: toolCount,
          round_count: roundCount,
        });
        // Inefficient batch pattern warning — if you did 3+ rounds yet tool/round <1.5,
        // there is no parallel batch (sequential single-tool calls).
        const ratio = toolCount / Math.max(roundCount, 1);
        if (roundCount >= 3 && ratio < 1.5) {
          logger.warn("verimsiz_batch_pattern", {
            toolCount,
            roundCount,
            ratio: Number(ratio.toFixed(2)),
            mesaj: "Tools were called sequentially, no parallel batch",
          });
        }
      } catch (e) {
        logger.warn("turn_metrics_record_hata", { hata: (e as Error).message });
      }
    }
    // M5: pendingExtraGroups removed. load_toolset is PERSISTENT (persisted in
    // chief.json) — open again after restart. Single-turn intent-based extra groups are
    // regex-triggered and disappear automatically.
    const planYarim = detectHalfPlan(reply, orphanedTools.length, gotResult);
    // Reflection — fire-and-forget, shown on screen on the next turn.
    // SAVING: Off by default. Only (a) on effort=high turns (the chief is already bound to
    // expensive thinking, an extra critique stays cheap), (b) the reflectOnNextTurn flag is
    // on (manual /reflect or a UI command), (c) if there is a real error (orphanedTools or
    // tool errors >2). Otherwise a Sonnet critique every turn eats unnecessary output.
    const reflectionEnabled =
      effectiveEffort === "high" ||
      state.reflectOnNextTurn ||
      orphanedTools.length > 0 ||
      aktiviteFinal.filter((t) => t.hata).length > 2;
    if (reflectionEnabled && gotResult && !transient && reply) {
      state.pendingReflection = reflect({
        reply,
        tools: aktiviteFinal.map((t) => ({
          ad: t.ad,
          girdi: t.girdi,
          hata: t.hata,
        })),
      }).catch(() => "OK");
    }
    state.reflectOnNextTurn = false;
    // Final cost — filled from result.usage; compute $ with pricing.ts.
    // PRICING CORRECTION: 2x tier if actual context >200k.
    // Fix 102: cache_create defaults to 5m. Anthropic API cache_creation_input_tokens
    // comes in the 5m default tier; when the proxy 1h beta header (ARCHITECT_CCH_MOVE=1)
    // is active it counts as 1h. When default OFF, 5m is more accurate — the old "everything
    // 1h" logic overestimated the cost by 60%+ ($0.137 instead of $0.219 for Opus).
    const totalCtxFinal = costUncached + costCacheRead + costCacheCreate;
    const finalPrice = priceForModel(liveModel || sessionModel, {
      is1m: isOpus(sessionModel),
      totalContext: totalCtxFinal,
    });
    const cchIs1h = (process.env.ARCHITECT_CACHE_1H === "1" || process.env.ARCHITECT_CCH_MOVE === "1");
    const finalUsd = estimateCost(
      {
        uncachedInput: costUncached,
        cacheRead: costCacheRead,
        cacheCreate1h: cchIs1h ? costCacheCreate : 0,
        cacheCreate5m: cchIs1h ? 0 : costCacheCreate,
        output: costOut,
      },
      finalPrice,
    );
    costTracker.addSessionUsd(finalUsd);
    costTracker.recordUsd(finalUsd);
    // F4: write the chief/architect/advisor turn cost to the budget. The specialist/worker
    // tool types do not separately record their own delegate cost — for now the single
    // line item is the chief turn's. Per-specialist cost attribution later in Phase F4.2.
    try {
      budgetManager.recordSpend(projectName, selfBudgetRole, finalUsd);
    } catch {
      /* ignore */
    }
    return {
      reply,
      transient,
      aktivite: aktiviteFinal,
      segments,
      cost: {
        in: costIn,
        out: costOut,
        cacheRead: costCacheRead,
        cacheCreate1h: costCacheCreate,
        cacheCreate5m: 0,
        uncached: costUncached,
        usd: finalUsd,
        model: liveModel || sessionModel,
      },
      images: collectedImages,
      planYarim,
      orphanedTools,
      autonomousFail,
      resumeLostReason,
    };
  };
}
