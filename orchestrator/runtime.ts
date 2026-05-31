import type { Options } from "@anthropic-ai/claude-agent-sdk";

// --- Plugin yonetimi (SDK plugins opsiyonu) ---
let pluginPaths: string[] = [];

export function setPlugins(paths: string[]): void {
  pluginPaths = [...new Set(paths)];
}

export function getPluginPaths(): string[] {
  return [...pluginPaths];
}

type SdkPlugin = { type: "local"; path: string };

function sdkPlugins(): SdkPlugin[] {
  return pluginPaths.map((p) => ({ type: "local", path: p }));
}

// --- Anthropic proxy base URL ---
// orchestrator/main.ts startup'inda anthropicProxy.start() ile alinan
// 127.0.0.1:NNNN adresini set eder. SDK query'ler subprocess'e env olarak
// gecirildiginde @anthropic-ai/sdk bu baseURL'i kullanip TUM Anthropic
// isteklerini proxy'ye yonlendirir; proxy de cache_control + beta header
// inject eder.
let anthropicProxyBaseUrl: string | null = null;

export function setAnthropicProxyBaseUrl(url: string | null): void {
  anthropicProxyBaseUrl = url;
}

export function getAnthropicProxyBaseUrl(): string | null {
  return anthropicProxyBaseUrl;
}

// --- Ortak query opsiyonlari ---
// Guvenlik hook'u yok — tum sefler, uzmanlar ve worker'lar engelsiz
// terminal kullanabilir (tam otonom sistem).
// env: proxy aktifse subprocess'e ANTHROPIC_BASE_URL paslanir; process.env
// taban olarak korunur (PATH, HOME vs gerekli).
export function runtimeOptions(): Pick<Options, "plugins" | "env"> {
  const opts: Pick<Options, "plugins" | "env"> = {};
  const plugins = sdkPlugins();
  if (plugins.length) opts.plugins = plugins;
  if (anthropicProxyBaseUrl) {
    // process.env kopyala (undefined degerleri filtrele); ustune yaz.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") env[k] = v;
    }
    env.ANTHROPIC_BASE_URL = anthropicProxyBaseUrl;
    // Bazi SDK versionlari ayrica ANTHROPIC_API_URL'i tani; her ikisini de
    // set et — biri yetersizse digerinin tutmasi icin guvenli.
    env.ANTHROPIC_API_URL = anthropicProxyBaseUrl;
    opts.env = env;
  }
  return opts;
}
