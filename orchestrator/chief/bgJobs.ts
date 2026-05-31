// orchestrator/chief/bgJobs.ts — Async delegation (Approach C, host-orchestrated).
//
// Problem: specialist delegation via the native Agent tool is BLOCKING — the chief
// turn stays open until the specialist finishes (2-10 min), the user cannot talk to
// the chief. The B (persistent streaming query) solution failed: background:true did
// not return a result within the chief turn -> the chief delegated again -> infinite
// loop + $15.
//
// C solution (this module): the specialist is started fire-and-forget as a SEPARATE
// top-level query(). The delege_arkaplan tool returns "job accepted" INSTANTLY, the
// chief turn closes immediately (user is free). The specialist runs in the background
// in its own query; when done, onComplete is called -> the host enqueues a resume turn
// on the SAME chief session (queue). The chief processes the result in a NEW turn.
// background:true is NOT USED; no loop risk (every job is finite, one-shot).
//
// Flag: ARCHITECT_ASYNC_DELEGE=1. OFF (default) -> the delege_arkaplan tool is not
// registered, and even if this module is instantiated it is never called. The
// existing blocking Agent delegation is unchanged.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { buildEconomyHooks } from "../sdkHooks.js";
import { runtimeOptions } from "../runtime.js";
import { singleSpecToAgent, toApiModel } from "../sdkAgents.js";
import { EFFORT_THINKING } from "../effort.js";
import type { AgentRegistry } from "../registry.js";
import type { UsageTracker } from "../usage.js";
import type { Logger } from "../logger.js";

export type BgJobStatus = "running" | "completed" | "error";

export interface BgCompleteInfo {
  specialist: string;
  summary: string;
  status: "completed" | "error";
  jobId: string;
  outputFile?: string;
}

export interface BgJob {
  jobId: string;
  parentSid: string;
  specialist: string;
  task: string;
  status: BgJobStatus;
  startTs: number;
  endTs?: number;
}

export interface BgJobManagerDeps {
  registry: AgentRegistry;
  projectRoot: string;
  usage: UsageTracker;
  logger: Logger;
  // Notifies the host when the specialist finishes — main.ts enqueues the resume turn on the SAME session.
  onComplete: (parentSid: string, info: BgCompleteInfo) => void;
  // Job started/finished UI notification (optional).
  onStatus?: () => void;
}

export interface BgJobManager {
  // The sid scope is provided in runChiefAttempt (tool_use detection) — the tool has no sid.
  startJob: (parentSid: string, specialistName: string, task: string) => string | null;
  listJobs: () => BgJob[];
  activeCount: (parentSid?: string) => number;
}

// Max time a single specialist may run in the background. If exceeded, abort + error.
const JOB_WALL_CLOCK_MS = 15 * 60 * 1000; // 15 min
// Runaway specialist protection — since it is fire-and-forget, the user is not watching.
const JOB_TOOL_LIMIT = 80;

export function createBgJobManager(deps: BgJobManagerDeps): BgJobManager {
  const { registry, projectRoot, usage, logger, onComplete, onStatus } = deps;
  const jobs = new Map<string, BgJob>();

  function buildSpecialistOptions(
    specName: string,
    abort: AbortController,
  ): Options | null {
    const spec = registry.get(specName);
    if (!spec) return null;
    const agentDef = singleSpecToAgent(spec);
    // Only built-in work tools. MCP tools (architect server) are not provided —
    // without the server a tool name becomes a dangling ref + the chief coordination
    // tools (delege/talk_to_chief) risk recursion. Intersect spec.allowedTools with
    // the built-in allowlist; if empty, the full built-in set.
    const BUILTIN = ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "WebFetch"];
    const specTools =
      agentDef.tools && agentDef.tools.length > 0
        ? agentDef.tools.filter((t) => BUILTIN.includes(t))
        : BUILTIN;
    const tools = specTools.length > 0 ? specTools : BUILTIN;
    return {
      // The specialist's own system prompt (identity + role + skill bodies).
      systemPrompt: agentDef.prompt,
      cwd: projectRoot,
      model: toApiModel(spec.model),
      maxThinkingTokens: EFFORT_THINKING[spec.effort],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      // Only built-in work tools — chief MCP tools (delege/coordination) are not
      // provided: no recursion + no cross-agent confusion. Focused work.
      tools,
      includePartialMessages: false,
      // Runaway protection: tool cap + output truncate. The specialist is fire-and-forget.
      hooks: buildEconomyHooks({
        toolLimit: JOB_TOOL_LIMIT,
        outputCap: 3000,
        label: `bg:${specName}`,
      }) as never,
      abortController: abort,
      ...runtimeOptions(),
    } as Options;
  }

  async function runSpecialistQuery(
    specName: string,
    task: string,
    abort: AbortController,
  ): Promise<{ text: string; status: "completed" | "error" }> {
    const opts = buildSpecialistOptions(specName, abort);
    if (!opts) return { text: `Specialist not found: ${specName}`, status: "error" };
    let text = "";
    let status: "completed" | "error" = "error";
    const stream = query({ prompt: task, options: opts }) as AsyncIterable<SDKMessage>;
    for await (const msg of stream) {
      // Fix 152: LIVE visibility — write the tool_use's in the specialist's assistant
      // turn (Read/Bash/Edit...) to the specialist's registry chat as "progress".
      // So when the user clicks the specialist card they see what it is doing RIGHT NOW.
      // includePartialMessages off (no text delta) -> only tool steps, cheap + capped
      // by JOB_TOOL_LIMIT. We do not mirror the text delta (disk thrash). The result is
      // also written at finalize.
      if (msg.type === "assistant") {
        const blocks = (msg as { message?: { content?: unknown } }).message?.content;
        if (Array.isArray(blocks)) {
          for (const b of blocks) {
            if (b && typeof b === "object" && (b as { type?: string }).type === "tool_use") {
              const tb = b as { name?: string; input?: Record<string, unknown> };
              const ad = tb.name ?? "tool";
              const arg =
                (typeof tb.input?.file_path === "string" && tb.input.file_path) ||
                (typeof tb.input?.command === "string" && tb.input.command) ||
                (typeof tb.input?.pattern === "string" && tb.input.pattern) ||
                (typeof tb.input?.path === "string" && tb.input.path) ||
                "";
              const argShort = arg ? ` ${String(arg).slice(0, 80)}` : "";
              try {
                registry.appendChat(specName, {
                  role: "uzman",
                  text: `⏳ ${ad}${argShort}`,
                  ts: Date.now(),
                });
                onStatus?.();
              } catch { /* best-effort */ }
            }
          }
        }
      }
      if (msg.type === "result") {
        if (msg.subtype === "success") {
          text = msg.result ?? "";
          status = "completed";
        } else {
          text = msg.errors.join("\n") || "[specialist turn failed]";
          status = "error";
        }
        const inTok =
          msg.usage.input_tokens + (msg.usage.cache_creation_input_tokens ?? 0);
        try {
          usage.record(specName, { input: inTok, output: msg.usage.output_tokens });
        } catch {
          /* usage best-effort */
        }
        break;
      }
    }
    return { text, status };
  }

  function startJob(
    parentSid: string,
    specialistName: string,
    task: string,
  ): string | null {
    if (!registry.get(specialistName)) {
      logger.warn("bgjob_uzman_yok", { specialist: specialistName, parentSid });
      return null;
    }
    const jobId = `bg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const abort = new AbortController();
    const job: BgJob = {
      jobId,
      parentSid,
      specialist: specialistName,
      task,
      status: "running",
      startTs: Date.now(),
    };
    jobs.set(jobId, job);
    logger.info("bgjob_basladi", { jobId, specialist: specialistName, parentSid });
    // Fix 152: write the task to the specialist's registry chat IMMEDIATELY -> when
    // the user clicks the specialist card they see the sent prompt WHILE it runs (the
    // native Agent path did this too; the bg-delegation path was missing it).
    try {
      registry.appendChat(specialistName, {
        role: "ajan_komut",
        text: task,
        ts: Date.now(),
      });
    } catch { /* best-effort */ }
    onStatus?.();

    // Wall-clock guard — abort if the specialist hangs.
    const killTimer = setTimeout(() => {
      try {
        abort.abort();
      } catch {
        /* ignore */
      }
    }, JOB_WALL_CLOCK_MS);

    const finalize = (text: string, status: "completed" | "error") => {
      clearTimeout(killTimer);
      const j = jobs.get(jobId);
      if (j) {
        j.status = status;
        j.endTs = Date.now();
      }
      // Fix 152: write the result to the specialist's registry chat -> the modal shows the result.
      try {
        registry.appendChat(specialistName, {
          role: "uzman",
          text: text || (status === "error" ? "[task ended with error]" : "[empty result]"),
          ts: Date.now(),
          hata: status === "error",
        });
      } catch { /* best-effort */ }
      logger.info("bgjob_bitti", {
        jobId,
        specialist: specialistName,
        status,
        sureMs: Date.now() - job.startTs,
      });
      onStatus?.();
      try {
        onComplete(parentSid, {
          specialist: specialistName,
          summary: text,
          status,
          jobId,
        });
      } catch (e) {
        logger.error("bgjob_oncomplete_hata", { jobId, mesaj: (e as Error).message });
      }
    };

    // Fire-and-forget — the chief turn does NOT wait.
    void runSpecialistQuery(specialistName, task, abort)
      .then((r) => finalize(r.text, r.status))
      .catch((e) =>
        finalize(`[background task error]: ${(e as Error).message}`, "error"),
      );

    return jobId;
  }

  return {
    startJob,
    listJobs: () => [...jobs.values()],
    activeCount: (parentSid?: string) =>
      [...jobs.values()].filter(
        (j) => j.status === "running" && (!parentSid || j.parentSid === parentSid),
      ).length,
  };
}
