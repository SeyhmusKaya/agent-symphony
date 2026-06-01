// Multi-provider model routing (Anthropic + DeepSeek).
//
// DeepSeek Anthropic-uyumlu endpoint (https://api.deepseek.com/anthropic) ile
// SDK/cli.js'in Anthropic Messages formatini AYNEN konusur — format cevirisi
// YOK. Proxy (anthropicProxy.ts) her istegin body.model'ine bakar: "deepseek*"
// ise upstream'i DeepSeek'e cevirir + x-api-key enjekte eder. Claude modeli ise
// mevcut davranis (api.anthropic.com + OAuth) korunur. Hibrit: ayni session'da
// model degisince provider de degisir, spawn-env'e bagli degil.
//
// Oncelik (resolveProvider): deepseekKey > anthropicKey > Max OAuth.
// Default model (defaultModelForRole), provider=deepseek ise: mimar/sef/danisman
// = v4-pro, uzman = v4-flash. Aksi halde mevcut sistem (opus-4-8) korunur.
//
// GUVENLIK: providers.json appDataDir'de tutulur, repoya ASLA gitmez.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { appDataDir } from "./fleet.js";

export type Provider = "deepseek" | "anthropic-key" | "anthropic-oauth";

export interface ProviderConfig {
  deepseekKey?: string;
  anthropicKey?: string;
}

// DeepSeek model slug'lari (doc: api-docs.deepseek.com). Ikisi de 1M context,
// 384K output, thinking + tool calls destekli.
export const DEEPSEEK_PRO = "deepseek-v4-pro";
export const DEEPSEEK_FLASH = "deepseek-v4-flash";
// Anthropic-uyumlu endpoint: host + path prefix. Proxy url'i (/v1/messages...)
// bu prefix ile birlestirir -> /anthropic/v1/messages.
export const DEEPSEEK_HOST = "api.deepseek.com";
export const DEEPSEEK_PATH_PREFIX = "/anthropic";

// Anthropic varsayilan model kataloğu (deepseek yokken ya da OAuth/anthropic-key
// varken UI'da gosterilen). helpers.ts'deki eski MODELS ile ayni.
export const ANTHROPIC_MODELS = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
];

export function providersFilePath(): string {
  return join(appDataDir(), "providers.json");
}

export function loadProviders(): ProviderConfig {
  const file = providersFilePath();
  if (!existsSync(file)) return {};
  try {
    const raw = readFileSync(file, "utf8").trim();
    if (!raw) return {};
    const p = JSON.parse(raw) as ProviderConfig;
    return {
      deepseekKey: p.deepseekKey?.trim() || undefined,
      anthropicKey: p.anthropicKey?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

export function saveProviders(cfg: ProviderConfig): void {
  const clean: ProviderConfig = {
    deepseekKey: cfg.deepseekKey?.trim() || undefined,
    anthropicKey: cfg.anthropicKey?.trim() || undefined,
  };
  writeFileSync(providersFilePath(), JSON.stringify(clean, null, 2), "utf8");
}

// Max OAuth credential'i var mi? (claude-code login). cli.js bunu
// ~/.claude/.credentials.json'da tutar; Claude modellerini ancak bu VEYA
// anthropicKey varsa sunariz.
export function hasOAuth(): boolean {
  try {
    const p = join(homedir(), ".claude", ".credentials.json");
    if (!existsSync(p)) return false;
    return readFileSync(p, "utf8").includes("claudeAiOauth");
  } catch {
    return false;
  }
}

export function isDeepSeekModel(model: string | undefined): boolean {
  return !!model && /deepseek/i.test(model);
}

// 1M-context modeller: opus (claude) + deepseek v4 (pro/flash). Context-window
// + auto-compact esigi bu fonksiyona gore secilir. (Pricing tier'i ayri:
// deepseek priceForModel'de zaten duz fiyat.)
export function is1mModel(model: string | undefined): boolean {
  if (!model) return false;
  return /claude-opus/i.test(model) || /deepseek/i.test(model);
}

// Insan-okur model adi (UI rozeti + kimlik prompt'u). DeepSeek slug'larini
// "DeepSeek V4 Pro/Flash" yapar; claude slug'larindan [1m]/[fast] eklerini atar.
export function modelDisplayName(model: string | undefined): string {
  if (!model) return "bilinmeyen model";
  const s = model.toLowerCase();
  if (s.includes("deepseek")) {
    return s.includes("pro") ? "DeepSeek V4 Pro" : "DeepSeek V4 Flash";
  }
  return model.replace(/\[.*?\]/g, "").trim();
}

// Oncelik resolver: deepseek > anthropic-key > anthropic-oauth.
export function resolveProvider(cfg: ProviderConfig = loadProviders()): Provider {
  if (cfg.deepseekKey) return "deepseek";
  if (cfg.anthropicKey) return "anthropic-key";
  return "anthropic-oauth";
}

// Hibrit: UI'da sunulacak model listesi. deepseek modelleri key varsa; claude
// modelleri anthropicKey VEYA OAuth varsa. Hicbiri yoksa (ilk kurulum) yine
// claude seti gosterilir — eski davranis bozulmaz.
export function availableModels(cfg: ProviderConfig = loadProviders()): string[] {
  const out: string[] = [];
  if (cfg.deepseekKey) out.push(DEEPSEEK_PRO, DEEPSEEK_FLASH);
  if (cfg.anthropicKey || hasOAuth()) out.push(...ANTHROPIC_MODELS);
  if (out.length === 0) out.push(...ANTHROPIC_MODELS);
  return out;
}

export type AgentRole = "mimar" | "sef" | "advisor" | "uzman";

// Rol bazli default model. provider=deepseek: uzman=flash, digerleri=pro.
// Aksi halde mevcut sistem (opus-4-8) — DEGISMEZ.
export function defaultModelForRole(
  role: AgentRole,
  cfg: ProviderConfig = loadProviders(),
): string {
  if (resolveProvider(cfg) === "deepseek") {
    return role === "uzman" ? DEEPSEEK_FLASH : DEEPSEEK_PRO;
  }
  return "claude-opus-4-8";
}
