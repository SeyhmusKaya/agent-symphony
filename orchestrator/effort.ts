// Thinking budget (extended thinking) management — automatic selection based
// on effort type + command content.
//
// Task #98/99: Added xhigh and max levels with Opus 4.8. The SDK
// AgentDefinition.effort accepts these values too. xhigh = "ultracode"
// setting (dynamic workflow trigger); max = highest thinking budget.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORT_THINKING: Record<Effort, number> = {
  low: 2000,
  medium: 10000,
  high: 31999,
  xhigh: 48000,   // ultracode — Anthropic dynamic workflow trigger
  max: 64000,     // highest standard thinking budget
};

// Dynamic effort based on command content: short/simple prompts do not inflate the thinking budget.
const HIGH_PATTERN =
  /\b(refactor|mimari|tum sistem|baştan yaz|büyük|massive|tüm proje|architecture)\b/i;
const PLAN_PATTERN =
  /\b(plan|tasarla|tasarim|analiz|incele|öner|design|propose|review|kararla|secenek)\b/i;

export function pickEffort(
  prompt: string,
  planActive: boolean,
  fallback: Effort,
): Effort {
  const t = prompt.trim();
  if (HIGH_PATTERN.test(t)) return "high";
  if (planActive) return fallback === "low" ? "medium" : fallback;
  if (PLAN_PATTERN.test(t)) return fallback === "low" ? "medium" : fallback;
  // Short / simple prompts: fewer than 80 chars and no complex keyword -> low.
  if (t.length < 80) return "low";
  return fallback;
}
