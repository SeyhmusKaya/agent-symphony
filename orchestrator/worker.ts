import { query } from "@anthropic-ai/claude-agent-sdk";
import type { TokenUsage } from "./usage.js";
import { WORKER_PROMPT } from "./prompts.js";
import { extractTranscript } from "./sdkTranscript.js";
import { runtimeOptions } from "./runtime.js";
import { buildEconomyHooks } from "./sdkHooks.js";
import { getActiveCodeGraph } from "./codegraph/index.js";
import {
  buildCodeGraphMcpServer,
  CODEGRAPH_TOOL_NAMES_FOR_SUBAGENTS,
} from "./codegraph/mcpTools.js";

// COST SAVING: worker is a fire-forget one-shot short job — Haiku 4-5 is enough
// and ~3x cheaper than Sonnet (input $1 / output $5 vs $3/$15). Minimal quality
// loss: the work given to the worker is 1-3 paragraphs of exploration/search, no
// need to set up a network. For complex work the chief already calls a specialist
// (Sonnet/Opus) via delegate.
export const WORKER_MODEL = "claude-haiku-4-5";
export const MAX_CONCURRENT_WORKERS = 8;

export interface WorkerResult {
  task: string;
  result: string;
  isError: boolean;
  usage: TokenUsage;
  transcript: string;
}

export async function spawnWorker(task: string): Promise<WorkerResult> {
  // P0.1: Cache prefix stability — tools are FIXED (intent regex removed).
  // The worker is fire-forget short work but prompt cache still helps;
  // intent-based tool changes were invalidating the cache. 6 fixed tools, ~1k
  // schema cost as a one-time cache write, subsequent workers cache hit.
  // CodeGraph: a pre-indexed graph for the worker's code search. Always loaded
  // to keep the cache prefix fixed (CORE-like). Schema ~3-5k cached prefix.
  const codeGraphServer = buildCodeGraphMcpServer(getActiveCodeGraph);
  const stream = query({
    prompt: task,
    options: {
      systemPrompt: WORKER_PROMPT,
      model: WORKER_MODEL,
      tools: ["Bash", "Read", "Grep", "Glob", "WebSearch", "WebFetch", ...CODEGRAPH_TOOL_NAMES_FOR_SUBAGENTS],
      mcpServers: { codegraph: codeGraphServer } as never,
      skills: [],
      maxThinkingTokens: 1500,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // COST SAVING: worker is fire-forget — no skill/agent/CLAUDE.md load needed.
      // Empty array = no sources loaded, minimum context.
      settingSources: [],
      // M36/M37: tool cap (10, a bit tighter because the worker is fire-forget
      // short work) + Bash output compress. Even though Haiku is cheap, a tool
      // explosion still produces cost.
      hooks: buildEconomyHooks({ toolLimit: 0, outputCap: 5000, label: "Worker" }) as never,
      ...runtimeOptions(),
    },
  });

  let result = "";
  let isError = false;
  const usage: TokenUsage = { input: 0, output: 0 };
  const transcriptParts: string[] = [];

  for await (const msg of stream) {
    if (msg.type === "assistant") {
      const text = extractTranscript(msg.message.content);
      if (text) transcriptParts.push(text);
    } else if (msg.type === "result") {
      isError = msg.is_error;
      result = msg.subtype === "success" ? msg.result : msg.errors.join("\n");
      usage.input = msg.usage.input_tokens + msg.usage.cache_creation_input_tokens;
      usage.output = msg.usage.output_tokens;
    }
  }

  return { task, result, isError, usage, transcript: transcriptParts.join("\n\n") };
}

export async function spawnWorkersParallel(tasks: string[]): Promise<WorkerResult[]> {
  const results: WorkerResult[] = new Array(tasks.length);
  let next = 0;

  async function lane(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await spawnWorker(tasks[i]);
    }
  }

  const laneCount = Math.min(MAX_CONCURRENT_WORKERS, tasks.length);
  await Promise.all(Array.from({ length: laneCount }, () => lane()));
  return results;
}
