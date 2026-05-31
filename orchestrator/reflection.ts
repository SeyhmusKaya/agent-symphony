// Reflection sibling chain — a fast, cheap critic agent (Haiku) reviews the
// parent agent's last turn in advance. The resulting critique is appended to
// the next turn's prompt, so if the chief loops/repeats/skips it comes back aware.
import { query } from "@anthropic-ai/claude-agent-sdk";

const REFLECT_SYS = `You are Architect's critic agent — you review the parent agent's (chief's) last turn and write a short critique.
You look for:
- Repetition/loop (same tool with same input 2+ times)
- Non-progressing behavior (many tools but no progress)
- Something clearly skipped (did not answer the user's question)
- Wrong tool choice (Grep should have been used instead of Read, etc.)
- Phase discipline violation (made an edit during exploration, etc.)

OUTPUT RULE: 0-3 bullets, each bullet a single short line in English. If there is no problem write ONLY "OK". Do not write sentences, only bullets. Maximum 60 words.
Good example: "- Read the same file 3 times, the first was enough."
Good example: "OK"
Bad example: "The chief ran many tools and then..."`;

// COST SAVING: Haiku 4-5 — reflection should be short and cheap. 3x cheaper
// than Sonnet 4-6 ($1/$5 vs $3/$15). Haiku is enough for a 60-word summary.
const REFLECT_MODEL = "claude-haiku-4-5";

export interface ReflectInput {
  reply: string;
  tools: Array<{ ad: string; girdi?: string; hata?: boolean }>;
}

export async function reflect(input: ReflectInput): Promise<string> {
  const tail = input.tools.slice(-20);
  const toolList =
    tail
      .map(
        (t) =>
          `- ${t.ad}${t.hata ? " [error]" : ""}${t.girdi ? ": " + t.girdi.slice(0, 100) : ""}`,
      )
      .join("\n") || "(no tools)";
  const prompt = `[Chief's last reply]\n${input.reply.slice(0, 1800)}\n\n[Tools run — last 20]\n${toolList}`;

  try {
    const stream = query({
      prompt,
      options: {
        systemPrompt: REFLECT_SYS,
        model: REFLECT_MODEL,
        maxThinkingTokens: 0,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        // COST SAVING: reflection only produces a short summary; no tools needed.
        // tools: [] = no built-in tool schemas are sent to the API at all (~5k tok).
        // skills: [] = do not load SKILL.md frontmatters.
        // settingSources: [] = no CLAUDE.md/skill/agent discovery.
        tools: [],
        skills: [],
        settingSources: [],
        includePartialMessages: false,
      },
    });
    let out = "";
    for await (const m of stream) {
      const typed = m as { type: string; message?: { content?: unknown[] } };
      if (typed.type === "assistant") {
        const content = typed.message?.content;
        if (Array.isArray(content)) {
          for (const b of content as Array<{ type: string; text?: string }>) {
            if (b.type === "text" && b.text) out += b.text;
          }
        }
      }
      if (typed.type === "result") break;
    }
    const cleaned = out.trim();
    if (!cleaned) return "OK";
    // Excessively long output → truncate.
    return cleaned.length > 600 ? cleaned.slice(0, 600) : cleaned;
  } catch {
    return "OK";
  }
}
