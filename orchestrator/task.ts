import { query } from "@anthropic-ai/claude-agent-sdk";
import { extractTranscript } from "./sdkTranscript.js";
import { runtimeOptions } from "./runtime.js";
import { buildEconomyHooks } from "./sdkHooks.js";
import { getActiveCodeGraph } from "./codegraph/index.js";
import {
  buildCodeGraphMcpServer,
  CODEGRAPH_TOOL_NAMES_FOR_SUBAGENTS,
} from "./codegraph/mcpTools.js";
import { resolveProvider, DEEPSEEK_PRO, DEEPSEEK_FLASH } from "./providers.js";

// Genel amacli izole gorev yurutucu — Claude Code "Task tool" muadili.
// Sef 5+ tool gerektiren is icin buna delege eder: izole SDK oturumu,
// kisa rapor donulur, sefin context'i sismeden kalir.

export type TaskModelKey = "haiku" | "sonnet" | "opus";

const MODEL_MAP: Record<TaskModelKey, string> = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
};

const TASK_SYSTEM_PROMPT =
  "Sen bir gorev yurutucu ajansin. Tek gorev al, calis, kisa rapor don. " +
  "Kullanicidan sorma; karar verip ilerle. Sonucu 5-10 satirda ozetle.";

// CodeGraph code_* tool'lari her zaman dahil (cache prefix stability).
// Task agent kod kesfi yaptiginda Bash grep yerine code_search/callers
// kullanmali.
const TASK_ALLOWED_TOOLS = [
  "Read", "Write", "Edit", "Grep", "Glob", "Bash",
  ...CODEGRAPH_TOOL_NAMES_FOR_SUBAGENTS,
];

export interface TaskUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate1h: number;
  cacheCreate5m: number;
}

export interface TaskAgentResult {
  result: string;
  isError: boolean;
  usage: TaskUsage;
}

function zeroUsage(): TaskUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate1h: 0, cacheCreate5m: 0 };
}

export async function runTaskAgent(
  opis: string,
  gorev: string,
  model: TaskModelKey = "sonnet",
): Promise<TaskAgentResult> {
  // Provider=deepseek: task subagent (worker sinifi) -> opus istegi v4-pro,
  // digerleri v4-flash. Aksi halde mevcut Anthropic slug.
  let modelId = MODEL_MAP[model] ?? MODEL_MAP.sonnet;
  if (resolveProvider() === "deepseek") {
    modelId = model === "opus" ? DEEPSEEK_PRO : DEEPSEEK_FLASH;
  }
  const prompt = `[${opis}]\n\n${gorev}`;
  try {
    const codeGraphServer = buildCodeGraphMcpServer(getActiveCodeGraph);
    const stream = query({
      prompt,
      options: {
        systemPrompt: TASK_SYSTEM_PROMPT,
        model: modelId,
        allowedTools: TASK_ALLOWED_TOOLS,
        tools: TASK_ALLOWED_TOOLS,
        mcpServers: { codegraph: codeGraphServer } as never,
        skills: [],
        maxThinkingTokens: 10000,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        // Izole oturum: kaynak yuku minimum, hicbir resume yok.
        settingSources: [],
        // M36/M37: cap kaldirildi (kullanici karari) — sadece output compress.
        hooks: buildEconomyHooks({ toolLimit: 0, outputCap: 6000, label: "Task" }) as never,
        ...runtimeOptions(),
      },
    });

    let result = "";
    let isError = false;
    const usage = zeroUsage();
    const transcriptParts: string[] = [];

    for await (const msg of stream) {
      if (msg.type === "assistant") {
        const text = extractTranscript(msg.message.content);
        if (text) transcriptParts.push(text);
      } else if (msg.type === "result") {
        isError = msg.is_error;
        result = msg.subtype === "success" ? msg.result : msg.errors.join("\n");
        const u = msg.usage as {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_creation?: {
            ephemeral_1h_input_tokens?: number;
            ephemeral_5m_input_tokens?: number;
          };
        };
        usage.input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        usage.output = u.output_tokens ?? 0;
        usage.cacheRead = u.cache_read_input_tokens ?? 0;
        usage.cacheCreate1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
        usage.cacheCreate5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
      }
    }

    if (!result && transcriptParts.length) {
      // Result mesaji yoksa transcript'in son parcasini ozet say.
      result = transcriptParts[transcriptParts.length - 1];
    }
    return { result, isError, usage };
  } catch (e) {
    return {
      result: `task hata: ${(e as Error).message ?? "bilinmeyen"}`,
      isError: true,
      usage: zeroUsage(),
    };
  }
}
