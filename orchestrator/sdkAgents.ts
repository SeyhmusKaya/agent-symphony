// Faz 1: Native Anthropic Agent SDK subagent entegrasyonu.
//
// Architect'in registry'sindeki uzman tanimlari → SDK ClaudeAgentOptions.agents
// dictionary'ye cevirilir. Sef SDK query'sinde `Agent` tool ile bu uzmanlari
// paralel olarak isolated context window'da spawn eder. Cold start cache_create
// patlamasi sifir (Task #93 native cozum).
//
// F1.3b: tek yol artik native Agent tool — specialist.ts subprocess akisi
// silindi. Persistent multi-turn uzman sohbeti gerekirse Agent tool'un kendi
// session resume davranisi kullanilir.

import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRegistry, SpecialistDef } from "./registry.js";
import { specialistSystemPrompt } from "./prompts.js";
import { loadGlobalSkills, buildSkillPromptBlockFromNames } from "./skills.js";
import { modelDisplayName } from "./providers.js";

// Fix 104: Model adi -> Anthropic API'ye gidecek slug.
// - "-fast" / "[fast]": Anthropic 'fast' adli model tanimiyor (404).
//   Fast tier ileride service_tier parametresi olarak F4'te gelecek; o gune
//   kadar slug'tan striplenir.
// - "[1m]": Anthropic opus icin 1m context alias. Opus daima 1m kullanildigi
//   icin model adinda yoksa otomatik eklenir; sonnet/haiku icin striplenir.
function cleanModelSlug(model: string): string {
  // DeepSeek slug'lari (deepseek-v4-pro / -flash) AYNEN gider — [1m]/-fast
  // transformlari Anthropic'e ozgu, DeepSeek'te 400 verir.
  if (/deepseek/i.test(model)) return model.trim();
  let s = model
    .replace(/\s*\[\s*fast\s*\]/gi, "")
    .replace(/-fast\b/gi, "")
    .trim();
  const isOpus = /claude-opus/i.test(s);
  const has1m = /\[\s*1m\s*\]/i.test(s);
  if (isOpus && !has1m) s += "[1m]";
  if (!isOpus && has1m) s = s.replace(/\s*\[\s*1m\s*\]/gi, "");
  return s;
}

// Alias for clarity at SDK call sites — same logic, signals intent.
export function toApiModel(model: string): string {
  return cleanModelSlug(model);
}

// effort field SDK'da "low|medium|high|xhigh|max" — Architect registry'sinin
// Effort type'i ile birebir. Defensive guard: registry'den beklenmedik string
// gelirse medium fallback.
type SdkEffort = "low" | "medium" | "high" | "xhigh" | "max";

function mapEffort(e: string): SdkEffort {
  if (e === "low" || e === "medium" || e === "high" || e === "xhigh" || e === "max") return e;
  return "medium";
}

export interface BuildAgentsOpts {
  // Sef'in normal allowedTools listesi. Subagent'a verirken bu listenin altkumesi
  // verilir (uzman spec.allowedTools varsa o, yoksa parent-inherit/undefined).
  chiefAllowedTools: string[];
  // Uzmanlarin git tool'larini kullanmasi yasak (Fix: sadece sef versiyon
  // kontrolu yapar). disallowedTools'a hep eklenir.
  forbiddenForSpecialist?: string[];
}

const DEFAULT_FORBIDDEN: string[] = ["git_commit", "git_push", "rebuild_ui", "restart_self"];

/**
 * Registry'deki uzmanlarin SDK AgentDefinition dictionary'sini insa eder.
 * Sef query options.agents'a verilir; sef "Agent" tool'u ile bu uzmanlari
 * isolated context'te paralel spawn edebilir.
 */
export function buildSdkAgents(
  registry: AgentRegistry,
  opts: BuildAgentsOpts,
): Record<string, AgentDefinition> {
  const forbidden = new Set(opts.forbiddenForSpecialist ?? DEFAULT_FORBIDDEN);
  const result: Record<string, AgentDefinition> = {};
  for (const spec of registry.list()) {
    result[spec.name] = specToAgent(spec, forbidden);
  }
  return result;
}

function specToAgent(
  spec: SpecialistDef,
  forbidden: Set<string>,
): AgentDefinition {
  // Spec.allowedTools dolu ise onu kullan; bos ise parent'tan miras.
  let tools: string[] | undefined;
  if (spec.allowedTools && spec.allowedTools.length > 0) {
    tools = spec.allowedTools.filter((t) => !forbidden.has(t));
  }
  const disallowedTools = [...forbidden];

  // F2: registry'deki spec.skills + global skill listesini AgentDefinition.skills
  // field'a verir. SDK subagent context'e ad bazli yukler. Yalniz adlar; iceriksiz
  // SKILL.md'leri SDK ~/.claude/skills/ veya .claude/skills/ icinden okur — eger
  // skill dosyalari ~/.architect/skills/ icinde ise SDK gormez. Bu bilinen bos
  // (gap) — bkz. docs/f2-skill-system-notes.md.
  const specSkills = Array.isArray(spec.skills) ? spec.skills : [];
  const globalNames = loadGlobalSkills().map((s) => s.name);
  // Dedup: spec'e ozel skill + global; ayni ad tekrar etmesin.
  const merged = Array.from(new Set<string>([...specSkills, ...globalNames])).filter(Boolean);

  // F2 skill enjeksiyonu: spec.skills + global skill GOVDELERINI subagent
  // prompt'una dogrudan ekle. SDK skills field discovery'ye guvenmiyoruz
  // (settingSources=[] + ~/.architect/skills yolu SDK'ca taranmiyor) — isim
  // listesi icerik yuklemiyordu. Govde enjeksiyonu kesin calisir.
  const skillBlock = buildSkillPromptBlockFromNames(merged);

  return {
    description: spec.role || `${spec.name} uzmani`,
    prompt: specialistSystemPrompt(spec.name, spec.role, modelDisplayName(spec.model)) + skillBlock,
    tools,
    disallowedTools,
    model: cleanModelSlug(spec.model),
    effort: mapEffort(spec.effort),
    skills: merged.length > 0 ? merged : undefined,
    // background field default false — sef call ettiginde blocking calisir.
    // Faz 3'te background:true ile fire-and-forget secimi yapilabilir.
  };
}

/**
 * Tek bir uzman spec'i icin SDK AgentDefinition uretir. Run-time create_agent /
 * remove_agent oldugunda main.ts dictionary'i guncellemek icin kullanir.
 */
export function singleSpecToAgent(spec: SpecialistDef): AgentDefinition {
  return specToAgent(spec, new Set(DEFAULT_FORBIDDEN));
}

export { cleanModelSlug };
