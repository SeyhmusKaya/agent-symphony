// orchestrator/tools/types.ts — ToolContext + common helpers.
// The core of the tools.ts splitting refactor: 14 category modules import ToolContext +
// ok/fail/cap* from this file. The old tools.ts is now a re-export shim from this
// directory; main.ts can still import "./tools.js", no breakage.

import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRegistry } from "../registry.js";
import type { ProjectConfigStore } from "../config.js";
import type { Fleet } from "../fleet.js";
import type { UsageTracker } from "../usage.js";
import type { FileCoordinator } from "../locks.js";
import type { AuditLog } from "../audit.js";
import type { SharedMemory, TaggedMemory } from "../memory.js";
import type { NoteStore } from "../notes.js";
import type { RepoCatalogStore } from "../repoCatalog.js";
import type { ToolUsageStats } from "../toolUsageStats.js";
import type { CodeGraph } from "../codegraph/index.js";

// The type returned by the SDK tool() builder. tool() is parameterized by a generic
// ZodRawShape — each call resolves its own Schema generic. We do not use this type
// explicitly in the return annotation because the generic stays in a contravariant
// position; TS infers the modules' return type (union widen). `ToolDef` is exported only
// to make a single element meaningful in places like the createSdkMcpServer({tools})
// signature.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolDef = SdkMcpToolDefinition<any>;

export type EmitFn = (type: string, payload: Record<string, unknown>) => void;

// Single source: ToolContext (identical to the old tools.ts:160-232).
// Each category module takes it as a parameter.
export interface ToolContext {
  registry: AgentRegistry;
  emit: EmitFn;
  projectRoot: string;
  usage: UsageTracker;
  locks: FileCoordinator;
  audit: AuditLog;
  memory: SharedMemory;
  tagged: TaggedMemory;
  notes: NoteStore;
  // Ecosystem-wide shared GitHub tool/repo catalog (global, shared by all agents).
  catalog: RepoCatalogStore;
  config: ProjectConfigStore;
  fleet: Fleet;
  projectId: string;
  projectName: string;
  port: number;
  // For asking the user a multiple-choice question — the orchestrator resolves the promise.
  askUser?: (
    soru: string,
    secenekler: string[],
    cokluSecim: boolean,
    serbestMetin: boolean,
  ) => Promise<string>;
  // F1.3b: the bgTasks field was removed — the BgTaskManager + background delegate
  // subprocess flow was deleted as part of Option B. The chief now spawns specialists via
  // the native Agent tool; if fire-and-forget behavior is needed, the Agent tool's
  // background:true mode will be evaluated in Phase 3.
  // After interaction with an advisor agent the orchestrator marks this and triggers
  // auto-compact at the end of the turn. This way the advisors' long replies do not bloat
  // the project chief's context.
  markAdvisorInteraction?: () => void;
  // Tool usage telemetry — main.ts calls recordTurn at the end of the turn,
  // tool_usage_report produces a report from this store.
  toolUsage?: ToolUsageStats;
  // When load_toolset is called, the orchestrator uses this callback to write the group
  // PERSISTENTLY to chief storage — regardless of restart/new session, the groups stay
  // open. The unloadToolset callback is used to undo it.
  requestToolset?: (groups: string[]) => void;
  // Fix 137: after load_toolset, enqueues an AUTONOMOUS continue turn. A new tool group is
  // active only on the NEXT query (SDK tools are set at the start of a query). Previously
  // the user had to send a "continue" message (bad UX, the agent looked frozen). This
  // callback enqueues an autonomous "[continue] tool loaded, proceed" turn into the active
  // chief's session → when the current turn ends the same runner picks it up, the new
  // tools active. No user message needed.
  requestToolsetContinue?: (groups: string[]) => void;
  unloadToolset?: (groups: string[]) => void;
  // Reads the currently open groups — to show the state in the load_toolset reply message.
  // (The default core + git are always open anyway.)
  listLoadedToolsets?: () => string[];
  // Instant status push — tools that change the registry like create_agent/remove_agent/
  // import_agent call this so the UI's agents list updates live. Without it the UI shows
  // the old list until the next status broadcast.
  refreshStatus?: () => void;
  // CodeGraph: pre-indexed code knowledge graph. Loaded fixed (cache prefix stability). If
  // enable is false for the project the getter returns null and the tools give a "not
  // active" message at runtime.
  codeGraph?: () => CodeGraph | null;
  // Fix 89: asks for the active session model to fill list_agents' "self" field. The
  // architect/chief/advisor should see their own tool list — return their own metadata to
  // the caller, not just the specialists + advisors.
  getSessionModel?: () => string;
  // F1.3b: buildSpecialistEmitter was removed — there is no specialist subprocess, the
  // live stream goes through the Agent tool's own events.
  // F3 (autonomous 3-day mode): AutonomousManager getter. Set on ctx in main.ts after the
  // AutonomousManager is built. Without it the autonomous tools return fail ("autonomous
  // mode is not configured").
  autonomousManager?: () => import("../autonomousMode.js").AutonomousManager | null;
  // F4 (Cost Control): BudgetManager getter. The get_budget_report and set_budget_cap MCP
  // tools read/write the cap/state through it. Via refreshStatus + WS pushStatus the UI
  // BudgetCard updates instantly.
  budgetManager?: () => import("../budgetManager.js").BudgetManager | null;
}

// Self-identity: derived from ToolContext in index.ts, passed to the category modules as
// extra context alongside ToolContext. In the agent tools list_agents + talk_to_chief +
// report_to_mimar use the self info.
export interface ChiefSelf {
  isMimar: boolean;
  isAdvisor: boolean;
  kind: "mimar" | "advisor" | "sef";
}

export function selfFromContext(ctx: Pick<ToolContext, "projectId">): ChiefSelf {
  const isMimar = ctx.projectId === "__global__";
  const isAdvisor = ctx.projectId.startsWith("__advisor_");
  return {
    isMimar,
    isAdvisor,
    kind: isMimar ? "mimar" : isAdvisor ? "advisor" : "sef",
  };
}

// SDK content helpers — so each tool does not write its return type by hand.
export function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

// Protects the chief's context from raw stdout bloat. Cut head + tail and mark the middle
// with "[... N characters truncated ...]".
export function capLarge(text: string, cap: number): string {
  if (!text || text.length <= cap) return text;
  const head = text.slice(0, Math.floor(cap * 0.6));
  const tail = text.slice(-Math.floor(cap * 0.3));
  const removed = text.length - head.length - tail.length;
  return `${head}\n\n[... ${removed} characters truncated ...]\n\n${tail}`;
}

// Separate caps per tool type — delegate result, ssh, log/audit.
export const DELEGATE_RESULT_CAP = 8000;
export const SSH_RESULT_CAP = 15000;
export const LOG_RESULT_CAP = 12000;

export function capDelegate(text: string): string {
  return capLarge(text, DELEGATE_RESULT_CAP);
}

// The prohibition added to all specialist/worker prompts — git authority is only on the chief.
export const GIT_YASAK =
  "\n\nRULE: Do not run git commands (commit, push, add, reset, etc.). " +
  "Only the chief manages version control.";

// The recordUsage helper is produced in index.ts and passed as a prop to the category
// modules. The single emit("token_guncelleme") call is centralized.
export type RecordUsageFn = (agent: string, u: { input: number; output: number }) => void;
