// Anthropic API local HTTP proxy.
//
// Amac: claude-agent-sdk subprocess'i Anthropic'a istek atarken araya girip
// (1) systemPrompt + tools + rolling assistant message bloklarina
// cache_control: { type: "ephemeral", ttl: "1h" } ekler, (2) "anthropic-beta:
// extended-cache-ttl-2025-04-11" header'i enjekte eder. Kullanici pause/draft
// pencerelerinde (5-55dk) cache hot kalir, re-bill 10-20x ucuzlar.
//
// Subprocess'in ANTHROPIC_BASE_URL env var'i bu proxy'nin localhost adresine
// set edilir; SDK kullandigi @anthropic-ai/sdk standart bir sekilde baseURL'i
// degistirip TUM isteklerini buraya gonderir. Proxy /v1/messages POST'larini
// body modify edip, diger pathleri (oauth, models, vb.) saf pass-through ile
// https://api.anthropic.com'a iletir. SSE stream sifirsiz pipe edilir.
//
// Hata profili: proxy hatasi olursa client (SDK) 502 alir, SDK'nin kendi
// retry mekanizmasi devreye girer; OAuth refresh path'i hic dokunulmadigi
// icin auth bozulmaz.

import * as http from "node:http";
import * as https from "node:https";
import * as zlib from "node:zlib";
import { CACHE_BOUNDARY } from "./cacheMarker.js";

const UPSTREAM_HOST = "api.anthropic.com";
const BETA_NAME = "extended-cache-ttl-2025-04-11";
// Fix 105: cache TTL artik env-controlled. Default "5m" — proxy 5m gonderir,
// backend pricing.ts cchIs1h=false ile uyumlu (cost gosterimi gercege esit).
// 1h aktivasyon icin ARCHITECT_CCH_MOVE=1 set et — hem proxy 1h cache_control
// hem pricing 1h fiyatla hesaplar. Eski "her zaman 1h" davranisi: pricing 5m
// fiyatla hesaplarken proxy 1h fatura kesiyordu (gercekte fatura > UI ~%60).
// Context-cache fix: 1h cache TTL'i 429-riskli billing-header-move'dan AYIR.
//   ARCHITECT_CACHE_1H=1  -> SADECE 1h cache TTL. GUVENLI: standart
//     extended-cache-ttl beta'sini kullanir, billing-header'a DOKUNMAZ
//     (429 sebebi moveBillingHeaderToMutable idi, TTL degil).
//   ARCHITECT_CCH_MOVE=1  -> hem 1h TTL hem billing-header-move (429-riskli;
//     eski coupling korunur, sadece test/dev).
// NEDEN 1h: 5m TTL ile turlar arasi >5dk boslukta cache EVICT olur -> sonraki
// tur tum history'i (200K-900K) yeniden cache_create eder ($$ patlama). 1h ile
// 1 saate kadar bosluklar cache'i sicak tutar -> "bu kadar fazla cache uretme"
// (cache_create spam) biter. cache_read degismez (pencere boyutuna bagli).
const CACHE_1H =
  process.env.ARCHITECT_CACHE_1H === "1" || process.env.ARCHITECT_CCH_MOVE === "1";
const CCH_TTL: "5m" | "1h" = CACHE_1H ? "1h" : "5m";
const CACHE_CTRL = { type: "ephemeral" as const, ttl: CCH_TTL };

// FAST MODE (priority service tier). UI'daki "fast" toggle bunu set eder
// (main.ts onSetModel + runChiefAttempt tur basinda). Aktifken proxy
// /v1/messages body'sine `service_tier: "auto"` ekler.
// NEDEN "auto" (NEDEN "priority" DEGIL): Anthropic Messages API request
// service_tier degerleri = "auto" | "standard_only". "auto" => hesapta
// priority kapasite VARSA priority kuyrugu (hizli) kullanir, YOKSA otomatik
// standart'a duser — kapasite hatasi imkansiz, native guvenli fallback.
// Ham "priority" ise bir REQUEST degeri degil (o RESPONSE usage alaninda
// "hangi tier kullanildi" bilgisi). Bu yuzden istek body'sine "auto" yazariz.
// Race-safe: proxy per-process; iki session farkli fast degeriyle ayni anda
// calissa bile "auto" zararsiz (hizlandirir, asla bozmaz).
let fastModeOn = false;
export function setFastMode(on: boolean): void {
  fastModeOn = on;
}
export function getFastMode(): boolean {
  return fastModeOn;
}

export interface ProxyStats {
  totalRequests: number;
  modifiedRequests: number;
  strippedReminders: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  startedAt: number;
}

const stats: ProxyStats = {
  totalRequests: 0,
  modifiedRequests: 0,
  strippedReminders: 0,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  startedAt: Date.now(),
};

export function getProxyStats(): ProxyStats {
  return { ...stats };
}

// Fix 130: proxy_size_breakdown throttle. Tur basina cache_creation maliyetinin
// system vs tools vs history dagilimini OLCMEK icin (tahmin degil). Her istekte
// spam etmemek adina: en az 60sn aralik VEYA boyutlar materyal degisirse (system
// veya tools char sayisi >256 fark) yeniden logla. Per-process state.
let lastSizeLogAt = 0;
let lastSysChars = -1;
let lastToolsChars = -1;
const SIZE_LOG_MIN_INTERVAL_MS = 60_000;
const SIZE_LOG_MATERIAL_DELTA = 256;

export function resetProxyStats(): void {
  stats.totalRequests = 0;
  stats.modifiedRequests = 0;
  stats.strippedReminders = 0;
  stats.cacheReadTokens = 0;
  stats.cacheCreateTokens = 0;
  stats.uncachedInputTokens = 0;
  stats.outputTokens = 0;
  stats.startedAt = Date.now();
}

// body type belirsiz olabilir (Anthropic API zaman icinde degisir); minimum
// shape varsayariz, eksikse modify etmeyiz.
type AnyBlock = { type?: string; text?: string; cache_control?: unknown };
type AnyMessage = { role?: string; content?: string | AnyBlock[] };
type MessagesBody = {
  system?: string | AnyBlock[];
  tools?: AnyBlock[];
  messages?: AnyMessage[];
  service_tier?: "auto" | "standard_only";
};

// Fast mode: aktifse body'ye service_tier:"auto" enjekte et (priority varsa
// hizli, yoksa standart). Zaten set ise dokunma.
function injectServiceTier(body: MessagesBody): boolean {
  if (!fastModeOn) return false;
  if (body.service_tier === "auto") return false;
  body.service_tier = "auto";
  return true;
}

// Claude Code SDK binary'sinin user message'larina enjekte ettigi "gentle
// reminder" pattern'leri. Architect Mimar bunlarin hicbirine ihtiyac duymaz
// (task tracking yok, vs.) ama her tur 200-500 token ve ek cache miss
// maliyeti getirirler. Upstream'e gitmeden once strip ediyoruz — Claude API
// onlari hic gormez, model'in context'inde yer kaplamaz.
const USELESS_REMINDER_PATTERNS: RegExp[] = [
  // Task tracking spam — Architect'ta task araclari kullanilmiyor.
  /<system-reminder>\s*[\s\S]*?task tools haven['’]t been used recently[\s\S]*?<\/system-reminder>\s*/gi,
  // SessionStart hook + superpowers skill (~3k token) — Architect Mimar
  // superpower skill'lerine ihtiyac duymaz, kendi sistem prompt'u var.
  /<system-reminder>\s*SessionStart hook additional context[\s\S]*?<\/system-reminder>\s*/gi,
  // "Available agent types for the Agent tool" listesi (~600 token) —
  // Architect Agent tool kullanmaz; delegate / talk_to_chief / spawn_worker
  // kendi sistem prompt'unda zaten taniml.
  /<system-reminder>\s*Available agent types for the Agent tool[\s\S]*?<\/system-reminder>\s*/gi,
  // "MCP Server Instructions" (~500 token) — n8n/windows MCP varsa ozel
  // proje sistem prompt'unda gerektigi yerde aciklanir, her tur gerek yok.
  /<system-reminder>\s*#?\s*MCP Server Instructions[\s\S]*?<\/system-reminder>\s*/gi,
  /<system-reminder>\s*The following MCP servers have provided instructions[\s\S]*?<\/system-reminder>\s*/gi,
  // "The following skills are available" listesi (~2.5k token) — Architect
  // Skill tool kullanmaz, kendi tool'lariyla ayni ise yapar.
  /<system-reminder>\s*The following skills are available[\s\S]*?<\/system-reminder>\s*/gi,
];

function stripUselessReminders(body: MessagesBody): boolean {
  if (!Array.isArray(body.messages)) return false;
  let modified = false;
  const stripText = (s: string): string => {
    let out = s;
    for (const re of USELESS_REMINDER_PATTERNS) out = out.replace(re, "");
    return out;
  };
  for (const m of body.messages) {
    if (!m || m.role !== "user") continue;
    if (typeof m.content === "string") {
      const next = stripText(m.content);
      if (next !== m.content) {
        // Anthropic API empty content kabul etmiyor (400 "text content blocks
        // must be non-empty"). Strip sonucu bos kaldiysa placeholder koy.
        m.content = next.trim() === "" ? "." : next;
        modified = true;
      }
    } else if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b && b.type === "text" && typeof b.text === "string") {
          const next = stripText(b.text);
          if (next !== b.text) {
            b.text = next;
            modified = true;
          }
        }
      }
      // Bos text block'larini filtrele; tamamen bos kaldiysa placeholder.
      const filtered = m.content.filter(
        (b) => !(b && b.type === "text" && (b.text ?? "").trim() === ""),
      );
      if (filtered.length !== m.content.length) {
        m.content = filtered.length > 0
          ? filtered
          : [{ type: "text", text: "." }];
        modified = true;
      }
    }
  }
  return modified;
}

// SDK varsayilan 5dk cache_control ekleyebilir; biz 1h ile uzeryazacagimiz
// icin ONCE tum mevcut cache_control'leri strip et. Aksi halde toplam blok
// sayisi Anthropic max'i (4) gecip 400 yer.
// P1.7: tools schema kararsizligi fix — Claude Code SDK her tur tool listesini
// degistiriyor:
//   - `WaitForMcpServers` transient olarak ekleniyor (MCP server hazirlanirken).
//   - claude.ai cloud connectors (`mcp__claude_ai_Notion__*`, `mcp__claude_ai_Gmail__*`,
//     `mcp__claude_ai_Google_Drive__*`) ortak MCP server'lardan geliyor — bazi
//     turlerde sunucu zaman asimina ugruyor, tool listesinden dusuyor, sonraki
//     turde geri geliyor.
// Tools listesi 1 token degisik = Anthropic `tools` cache prefix komple iptal,
// her turde ~6-15k cacheCreate. Architect bu external connector'lari kullanmiyor
// (Notion icin Architect kendi MCP konfigurasyonunda baglar). Bu nedenle proxy
// onlari API'a gitmeden once filtre eder — tools listesi stabilize olur.
// Liste degistirilirse iliskili tool_use/tool_result mesaj bloklari da temizlenir.
const TRANSIENT_TOOL_NAMES = new Set<string>(["WaitForMcpServers"]);
const UNSTABLE_TOOL_PREFIXES = ["mcp__claude_ai_"];
function isStripTool(name: string): boolean {
  if (TRANSIENT_TOOL_NAMES.has(name)) return true;
  for (const p of UNSTABLE_TOOL_PREFIXES) if (name.startsWith(p)) return true;
  return false;
}
function stabilizeTools(body: MessagesBody): boolean {
  if (!Array.isArray(body.tools)) return false;
  const before = body.tools.length;
  const filtered = body.tools.filter(
    (t: AnyBlock & { name?: string }) => !isStripTool(t.name ?? ""),
  );
  // Alfabetik sirala — SDK tool sirasi tutarsiz olabilir; sort cache key sabit
  // tutar.
  filtered.sort((a: AnyBlock & { name?: string }, b: AnyBlock & { name?: string }) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
  body.tools = filtered;
  // tool_use/tool_result mesaj bloklarinda strip edilen tool referanslari varsa
  // onlari da kaldir — API "unknown tool" hatasi atmasin.
  if (Array.isArray(body.messages) && before !== filtered.length) {
    for (const m of body.messages) {
      if (!m || !Array.isArray(m.content)) continue;
      // Fix 135: extended thinking acikken (opus/effort -> task subagent), bir
      // assistant mesaji thinking/redacted_thinking blogu iceriyorsa o mesajdan
      // BLOK SILME. Anthropic kurali: "thinking blocks in the latest assistant
      // message cannot be modified" — tool_use blogunu cikarmak mesaji degistirir
      // ve 400 (messages.N.content.M) doner. Tarihsel WaitForMcpServers tool_use'u
      // current tools listesinde olmasa bile Anthropic kabul eder (sadece YENI
      // cagrilarda tools listesi kisitlar). Bu yuzden thinking-bearing assistant
      // mesajlarini oldugu gibi birak; sadece tools-array stabilize edilir (cache).
      if (
        (m as { role?: string }).role === "assistant" &&
        (m.content as Array<{ type?: string }>).some(
          (b) => b?.type === "thinking" || b?.type === "redacted_thinking",
        )
      ) {
        continue;
      }
      m.content = (m.content as Array<AnyBlock & { type?: string; name?: string; tool_use_id?: string }>).filter(
        (b) => {
          if (b?.type === "tool_use" && b.name && isStripTool(b.name)) return false;
          return true;
        },
      );
    }
  }
  return before !== filtered.length;
}

function stripCacheControl(body: MessagesBody): void {
  const stripBlocks = (blocks: AnyBlock[] | undefined): void => {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (b && typeof b === "object" && "cache_control" in b) {
        delete b.cache_control;
      }
    }
  };
  if (Array.isArray(body.system)) stripBlocks(body.system);
  stripBlocks(body.tools);
  if (Array.isArray(body.messages)) {
    for (const m of body.messages) {
      if (m && Array.isArray(m.content)) stripBlocks(m.content);
    }
  }
}

// P1.6 NOT USED (REVERTED): billing-header strip Anthropic'tan 429 aliyor.
// Anthropic muhtemelen claude-desktop telemetry'sini bekliyor; eksik olunca
// throttle. Cache prefix kaybi kabul edilebilir; billing-header korunmali.
// Tutarli iken — sadece SDK preamble "You are a Claude agent..." satirini
// strip ederiz; bu sabit metin throttle tetiklemez ama model kimligini
// "Claude" diye iddia etmesine yol acar (advisor "Pazarlama Uzmani" diyemiyor).
const SDK_PREAMBLE_RX = /You are a Claude agent, built on Anthropic's Claude Agent SDK\.?\s*/g;
function stripSdkPreamble(s: string): string {
  return s.replace(SDK_PREAMBLE_RX, "");
}

// Fix 73 — Option B: cch nonce'u IMMUTABLE blok disina cikar, MUTABLE blok
// basina yerlestir. immHash drift'in (her LLM call'da farkli) tek sebebi:
// SDK system prompt icine `x-anthropic-billing-header: ...; cch=<nonce>;`
// satirini her cagrida farkli nonce ile basiyordu. Bu IMMUTABLE blokun cache
// prefix'ini bozuyordu — her LLM call ~3.2k tok yeniden cache_create.
// Yontem: regex ile billing-header satirini bul, immutable'den cikar,
// CACHE_BOUNDARY'den SONRA (mutable'a) tasi. Header upstream'e gider (429 yok),
// immutable temiz kalir (cache hit). Mutable her tur farkli AMA cache_control
// almiyor — Anthropic onu zaten her tur input olarak tokenize ediyor, ekstra
// maliyet yok.
// FIX 73 BACKFIRE: 429 throttle gozlendi. Anthropic immutable blokta
// billing-header'i bekliyor — mutable'a tasinca request reddediliyor.
// Default OFF. ENV: ARCHITECT_CCH_MOVE=1 ile opt-in (sadece test/dev).
const BILLING_HEADER_LINE_RX = /^[ \t]*x-anthropic-billing-header[^\r\n]*[\r\n]?/gim;
function moveBillingHeaderToMutable(sysStr: string): string {
  if (!process.env.ARCHITECT_CCH_MOVE) return sysStr;
  const idx = sysStr.indexOf(CACHE_BOUNDARY);
  if (idx === -1) return sysStr;
  const immutable = sysStr.slice(0, idx);
  const mutable = sysStr.slice(idx + CACHE_BOUNDARY.length);
  const matches = immutable.match(BILLING_HEADER_LINE_RX);
  if (!matches || matches.length === 0) return sysStr;
  const cleaned = immutable.replace(BILLING_HEADER_LINE_RX, "");
  const headerBlob = matches.join("");
  return cleaned + CACHE_BOUNDARY + headerBlob + mutable;
}

// P1.2: systemPrompt 2 bloga ayrilir — main.ts CACHE_BOUNDARY marker'i
// koyar, proxy burada split eder. Sol blok IMMUTABLE (cache hedefi), sag
// blok MUTABLE (memSys/compact/plan; her tur degisebilir, cache_control
// almaz). Marker yoksa eski davranis (tek blok, son blok cache_control).
function splitSystemAtBoundary(sysStr: string): AnyBlock[] {
  const idx = sysStr.indexOf(CACHE_BOUNDARY);
  if (idx === -1) {
    return [{ type: "text", text: sysStr, cache_control: CACHE_CTRL }];
  }
  const immutable = sysStr.slice(0, idx);
  const mutable = sysStr.slice(idx + CACHE_BOUNDARY.length);
  const blocks: AnyBlock[] = [];
  if (immutable.length > 0) {
    blocks.push({ type: "text", text: immutable, cache_control: CACHE_CTRL });
  }
  if (mutable.length > 0) {
    blocks.push({ type: "text", text: mutable });
  }
  // Mutable bos olsa bile en az 1 blok (immutable+cache_control) doneriz.
  if (blocks.length === 0) {
    blocks.push({ type: "text", text: sysStr, cache_control: CACHE_CTRL });
  }
  return blocks;
}

function injectCacheControl(body: MessagesBody): boolean {
  stripCacheControl(body);
  let modified = false;

  // 1) system prompt — marker varsa 2 bloga ayrilir, immutable kismina
  //    cache_control. Marker yoksa tek blok son block'a cache_control
  //    (geriye uyum).
  // P1.6 REVERTED: stripBillingHeader devre disi. Anthropic billing tracking
  //   header'ini (`x-anthropic-billing-header: ...; cch=<nonce>;`) sistem
  //   prompt'inda bekliyor; strip etmek 429 throttle tetikliyor (test:
  //   claude CLI direct calisiyor; proxy uzerinden strip ile 429). Cache
  //   prefix kayip kabul edilebilir (cch nonce ~80 byte/turn ekstra), throttle
  //   olmaktan iyi.
  if (body.system) {
    if (typeof body.system === "string") {
      // Fix 73: SDK preamble + billing-header transform birlikte.
      const transformed = moveBillingHeaderToMutable(stripSdkPreamble(body.system));
      body.system = splitSystemAtBoundary(transformed);
      modified = true;
    } else if (Array.isArray(body.system) && body.system.length > 0) {
      const joined = stripSdkPreamble(
        body.system.map((b) => (typeof b?.text === "string" ? b.text : "")).join(""),
      );
      // Fix 73: billing-header'i mutable'a tasi (cache prefix korur).
      const transformed = moveBillingHeaderToMutable(joined);
      if (transformed.includes(CACHE_BOUNDARY)) {
        body.system = splitSystemAtBoundary(transformed);
        modified = true;
      } else {
        body.system = [{ type: "text", text: transformed, cache_control: CACHE_CTRL }];
        modified = true;
      }
    }
  }

  // 2) tools listesi son tool'una cache_control: stabil prefix (tools
  //    listesi nadiren degisir; degistiginde cache iptal olur, normal).
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const lastTool = body.tools[body.tools.length - 1];
    if (lastTool && typeof lastTool === "object") {
      lastTool.cache_control = CACHE_CTRL;
      modified = true;
    }
  }

  // Fix 46 CRITICAL: rolling cache HER TURDA MISS oluyordu. Eski mantik:
  // SADECE en son assistant'a cache_control. Bu yetersiz — Anthropic cache
  // sadece request'teki cache_control noktalarinda prefix arar; bir onceki
  // turun "last assistant" noktasini DA isaretlemezsek read miss olur.
  //
  // Senaryo: turn N → cache_control on assistant_{N-1} (last). Cache yazilir.
  // turn N+1 → SDK [..., assistant_N, user_{N+1}] gonderir. Last assistant
  // = assistant_N. Eski kod sadece assistant_N'i isaretlerdi → Anthropic
  // [..., assistant_N] prefix'i arar, cached degil (yeni). Asistant_{N-1}
  // isaretli olmadigi icin onceki turun cache'i okunamaz → 100k uncached
  // tokenize her tur.
  //
  // Yeni: SON 2 assistant mesajini isaretle. Boylece N+1 turunde Anthropic
  // [..., assistant_{N-1}] prefix'ini de kontrol eder → eski cache HIT.
  // Anthropic max 4 cache_control breakpoint: (1) system immutable, (2) last
  // tool, (3-4) son iki assistant. Tam kullanim.
  if (Array.isArray(body.messages) && body.messages.length >= 2) {
    let marked = 0;
    const maxMarks = 2; // son 2 assistant
    for (let i = body.messages.length - 1; i >= 0 && marked < maxMarks; i--) {
      const m = body.messages[i];
      if (m && m.role === "assistant" && m.content !== undefined) {
        if (typeof m.content === "string") {
          m.content = [
            { type: "text", text: m.content, cache_control: CACHE_CTRL },
          ];
          modified = true;
        } else if (Array.isArray(m.content) && m.content.length > 0) {
          const last = m.content[m.content.length - 1] as { type?: string; cache_control?: unknown };
          // Fix 135: thinking/redacted_thinking blogu DEGISTIRILEMEZ — uzerine
          // cache_control eklemek "thinking blocks cannot be modified" 400'u
          // tetikler. Son blok thinking ise bu mesaja cache_control KOYMA (bir
          // breakpoint eksilir, kabul edilebilir; dogruluk > cache). Normalde
          // son blok tool_use/text olur (thinking hep en basta), bu nadir bir
          // koruma. marked++ yine de yapilir ki maxMarks dogru sayilsin.
          if (last && typeof last === "object" && last.type !== "thinking" && last.type !== "redacted_thinking") {
            last.cache_control = CACHE_CTRL;
            modified = true;
          }
        }
        marked++;
      }
    }
  }

  return modified;
}

function mergeBetaHeader(headers: http.IncomingHttpHeaders): string {
  const cur = headers["anthropic-beta"];
  const set = new Set<string>();
  if (typeof cur === "string") {
    for (const v of cur.split(",")) {
      const t = v.trim();
      if (t) set.add(t);
    }
  } else if (Array.isArray(cur)) {
    for (const v of cur) {
      for (const x of String(v).split(",")) {
        const t = x.trim();
        if (t) set.add(t);
      }
    }
  }
  set.add(BETA_NAME);
  return Array.from(set).join(",");
}

interface ProxyUsage {
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}
function accUsage(u: ProxyUsage): void {
  if (typeof u.cache_read_input_tokens === "number")
    stats.cacheReadTokens += u.cache_read_input_tokens;
  if (typeof u.cache_creation_input_tokens === "number")
    stats.cacheCreateTokens += u.cache_creation_input_tokens;
  if (typeof u.input_tokens === "number")
    stats.uncachedInputTokens += u.input_tokens;
  if (typeof u.output_tokens === "number")
    stats.outputTokens += u.output_tokens;
}

// SSE veya JSON body'sinden usage telemetrisi parse — best effort.
// gzip ise once decompress; basarisizsa atla.
// Fix 52: ayrica per-request usage'i logger'a basarak cache hit/miss
// analizi yapilabilir. Donen perRequest object hem global stats'a yazilir
// hem logger ile diske.
function extractUsageTelemetry(
  buf: Buffer,
  contentType: string,
  contentEncoding: string,
): { input: number; cacheRead: number; cacheCreate: number; output: number } | null {
  let body: Buffer = buf;
  if (contentEncoding === "gzip") {
    try {
      body = zlib.gunzipSync(buf);
    } catch {
      return null;
    }
  } else if (contentEncoding === "br") {
    try {
      body = zlib.brotliDecompressSync(buf);
    } catch {
      return null;
    }
  } else if (contentEncoding === "deflate") {
    try {
      body = zlib.inflateSync(buf);
    } catch {
      return null;
    }
  }
  const text = body.toString("utf8");
  const per = { input: 0, cacheRead: 0, cacheCreate: 0, output: 0 };
  const apply = (u: ProxyUsage): void => {
    if (typeof u.input_tokens === "number") per.input = Math.max(per.input, u.input_tokens);
    if (typeof u.cache_read_input_tokens === "number") per.cacheRead = Math.max(per.cacheRead, u.cache_read_input_tokens);
    if (typeof u.cache_creation_input_tokens === "number") per.cacheCreate = Math.max(per.cacheCreate, u.cache_creation_input_tokens);
    if (typeof u.output_tokens === "number") per.output = Math.max(per.output, u.output_tokens);
    accUsage(u);
  };
  if (contentType.includes("event-stream")) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const obj = JSON.parse(payload) as { usage?: ProxyUsage; message?: { usage?: ProxyUsage } };
        if (obj.usage) apply(obj.usage);
        if (obj.message?.usage) apply(obj.message.usage);
      } catch {
        /* yoksay */
      }
    }
  } else if (contentType.includes("json")) {
    try {
      const obj = JSON.parse(text) as { usage?: ProxyUsage };
      if (obj.usage) apply(obj.usage);
    } catch {
      /* yoksay */
    }
  }
  return per.input + per.cacheRead + per.cacheCreate + per.output > 0 ? per : null;
}

async function handleRequest(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
): Promise<void> {
  const url = clientReq.url ?? "/";
  const method = clientReq.method ?? "GET";

  // Localhost-only diagnostic endpoint. Mimar restart sonrasi proxy gercekten
  // strip ediyor mu kontrol icin: curl localhost:<port>/__stats.
  if (url === "/__stats" && method === "GET") {
    const payload = JSON.stringify(stats, null, 2);
    clientRes.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    });
    clientRes.end(payload);
    return;
  }

  stats.totalRequests++;
  const isMessages = url.startsWith("/v1/messages");

  // Client body'sini topla (POST/PUT) — modify edebilmek icin.
  const chunks: Buffer[] = [];
  for await (const chunk of clientReq) chunks.push(chunk as Buffer);
  let bodyBuf = Buffer.concat(chunks);

  // Upstream headers — host upstream'e cevir, accept-encoding korunsun.
  const upstreamHeaders: http.OutgoingHttpHeaders = { ...clientReq.headers };
  delete upstreamHeaders.host;
  upstreamHeaders.host = UPSTREAM_HOST;
  // Bazi proxy header'lari upstream'de istenmez.
  delete upstreamHeaders["proxy-connection"];

  let didModify = false;
  if (isMessages && method === "POST" && bodyBuf.length > 0) {
    try {
      const body = JSON.parse(bodyBuf.toString("utf8")) as MessagesBody;
      const remindersStripped = stripUselessReminders(body);
      if (remindersStripped) stats.strippedReminders++;
      // P1.7: tools listesini stabilize et — strip transient/unstable, sort.
      stabilizeTools(body);
      const cacheChanged = injectCacheControl(body);
      // FAST MODE: fast toggle aciksa service_tier:"auto" ekle.
      const tierChanged = injectServiceTier(body);
      if (remindersStripped || cacheChanged || tierChanged) {
        didModify = true;
        if (cacheChanged) stats.modifiedRequests++;
        bodyBuf = Buffer.from(JSON.stringify(body), "utf8");
        upstreamHeaders["content-length"] = String(bodyBuf.length);
        upstreamHeaders["anthropic-beta"] = mergeBetaHeader(clientReq.headers);
      }
      // Fix 46: her zaman acik telemetri — immutable system block + tools hash
      // log. Cache invalidation tespiti icin: ardisik turlerde immHash AYNI
      // ise cache hit beklenir; degisiyorsa cache miss → fix lazim.
      try {
        const { createHash } = await import("node:crypto");
        const sysBlocks = Array.isArray(body.system) ? body.system : [];
        const immutableBlock = sysBlocks[0]?.text ?? "";
        const mutableBlock = sysBlocks[1]?.text ?? "";
        const immHash = createHash("sha1").update(immutableBlock).digest("hex").slice(0, 12);
        const toolsHash = Array.isArray(body.tools)
          ? createHash("sha1").update(JSON.stringify(body.tools.map((t: AnyBlock & { name?: string }) => t.name ?? "?"))).digest("hex").slice(0, 12)
          : "n/a";
        const lastUser = Array.isArray(body.messages)
          ? body.messages.filter((m) => m.role === "user").length
          : 0;
        const userContentSize = Array.isArray(body.messages) && body.messages.length
          ? JSON.stringify(body.messages[body.messages.length - 1]?.content ?? "").length
          : 0;
        plog("proxy_cache", {
          immHash,
          immLen: immutableBlock.length,
          mutLen: mutableBlock.length,
          toolsHash,
          toolsN: Array.isArray(body.tools) ? body.tools.length : 0,
          userTurns: lastUser,
          lastUserBytes: userContentSize,
        });
      } catch {
        /* yoksay */
      }
      // Fix 130: GROUND-TRUTH boyut olcumu — system/tools/messages tam char
      // sayilari + ~token (char/4). injectCacheControl body.system'i array'e
      // cevirmis olabilir; hem string hem array-of-blocks formunu ele al.
      // Throttle: 60sn'de bir VEYA system/tools boyutu materyal degisince.
      try {
        const sysChars = typeof body.system === "string"
          ? body.system.length
          : Array.isArray(body.system)
            ? body.system.reduce((a, b) => a + (b?.text?.length ?? 0), 0)
            : 0;
        const toolsJson = Array.isArray(body.tools) ? JSON.stringify(body.tools) : "";
        const toolsChars = toolsJson.length;
        const toolsN = Array.isArray(body.tools) ? body.tools.length : 0;
        const msgsChars = Array.isArray(body.messages)
          ? JSON.stringify(body.messages).length
          : 0;
        const now = Date.now();
        const material =
          Math.abs(sysChars - lastSysChars) > SIZE_LOG_MATERIAL_DELTA ||
          Math.abs(toolsChars - lastToolsChars) > SIZE_LOG_MATERIAL_DELTA;
        if (material || now - lastSizeLogAt >= SIZE_LOG_MIN_INTERVAL_MS) {
          lastSizeLogAt = now;
          lastSysChars = sysChars;
          lastToolsChars = toolsChars;
          plog("proxy_size_breakdown", {
            systemChars: sysChars,
            systemTokApprox: Math.round(sysChars / 4),
            toolsChars,
            toolsTokApprox: Math.round(toolsChars / 4),
            toolsN,
            messagesChars: msgsChars,
            messagesTokApprox: Math.round(msgsChars / 4),
            totalTokApprox: Math.round((sysChars + toolsChars + msgsChars) / 4),
          });
        }
      } catch {
        /* yoksay */
      }
      // Debug: dump system/tools/messages summary per request
      if (process.env.ARCHITECT_PROXY_DEBUG) {
        const { createHash } = await import("node:crypto");
        const sysBlocks = Array.isArray(body.system) ? body.system : [];
        const sysStr = typeof body.system === "string"
          ? body.system
          : sysBlocks.map((b) => b.text ?? "").join("");
        const sysHash = createHash("sha1").update(sysStr).digest("hex").slice(0, 12);
        const toolsHash = Array.isArray(body.tools)
          ? createHash("sha1").update(JSON.stringify(body.tools)).digest("hex").slice(0, 12)
          : "n/a";
        const msgRoles = Array.isArray(body.messages)
          ? body.messages.map((m: AnyMessage) => m.role).join(",")
          : "";
        const ccCount = JSON.stringify(body).match(/"cache_control"/g)?.length ?? 0;
        // Dump tool_use refs in messages to detect orphaned refs after strip
        let toolUseNames = "";
        let toolResultIds = "";
        if (Array.isArray(body.messages)) {
          for (const m of body.messages) {
            if (Array.isArray(m.content)) {
              for (const b of m.content as Array<AnyBlock & { type?: string; name?: string; tool_use_id?: string }>) {
                if (b?.type === "tool_use") toolUseNames += (b.name ?? "?") + ",";
                if (b?.type === "tool_result") toolResultIds += (b.tool_use_id ?? "?").slice(0, 8) + ",";
              }
            }
          }
        }
        console.log(`[proxy-dbg-msgs] tool_uses=${toolUseNames} tool_results=${toolResultIds}`);
        const blockSizes = sysBlocks.map((b) => (b.text ?? "").length).join("+");
        const block0Hash = sysBlocks[0]
          ? createHash("sha1").update(sysBlocks[0].text ?? "").digest("hex").slice(0, 12)
          : "n/a";
        const block1Hash = sysBlocks[1]
          ? createHash("sha1").update(sysBlocks[1].text ?? "").digest("hex").slice(0, 12)
          : "n/a";
        console.log(`[proxy-dbg] sys=${sysStr.length}c blocks=${blockSizes} b0sha=${block0Hash} b1sha=${block1Hash} sysAllSha=${sysHash} tools=${toolsHash} msgs=[${msgRoles}] cc=${ccCount}`);
        // P1-debug: dump first/last 200 chars of block 0 to see drift source
        if (sysBlocks[0]) {
          const t0 = sysBlocks[0].text ?? "";
          console.log(`[proxy-dbg-b0] HEAD: ${JSON.stringify(t0.slice(0, 200))}`);
          console.log(`[proxy-dbg-b0] TAIL: ${JSON.stringify(t0.slice(-200))}`);
        }
        // P1-debug: when tools SHA changes, dump tool names + a sample tool desc
        if (Array.isArray(body.tools)) {
          const names = body.tools.map((t: AnyBlock & { name?: string }) => t.name ?? "?").sort().join(",");
          console.log(`[proxy-dbg-tools] count=${body.tools.length} all=${names}`);
        }
      }
    } catch (e) {
      console.warn("[anthropic-proxy] body parse failed:", (e as Error).message);
    }
  }

  const upstreamReq = https.request(
    {
      method,
      hostname: UPSTREAM_HOST,
      port: 443,
      path: url,
      headers: upstreamHeaders,
    },
    (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 502;
      const respHeaders = { ...upstreamRes.headers };
      clientRes.writeHead(status, upstreamRes.statusMessage, respHeaders);
      const contentType = String(upstreamRes.headers["content-type"] ?? "");
      const contentEncoding = String(upstreamRes.headers["content-encoding"] ?? "");
      const captureForTelemetry =
        isMessages && status < 400 && bodyBuf.length > 0;
      const captured: Buffer[] = [];
      upstreamRes.on("data", (chunk: Buffer) => {
        if (captureForTelemetry) captured.push(chunk);
        // Backpressure korumasi yok — SSE genelde dusuk hizdir.
        clientRes.write(chunk);
      });
      upstreamRes.on("end", () => {
        clientRes.end();
        if (captureForTelemetry) {
          try {
            const per = extractUsageTelemetry(
              Buffer.concat(captured),
              contentType,
              contentEncoding,
            );
            // Fix 52: usage'i logger'a yazarak per-request cache hit/miss
            // analizi yap.
            if (per) {
              const total = per.input + per.cacheRead + per.cacheCreate;
              const cacheHitPct = total > 0 ? Math.round((per.cacheRead / total) * 100) : 0;
              plog("proxy_usage", {
                input: per.input,
                cacheRead: per.cacheRead,
                cacheCreate: per.cacheCreate,
                output: per.output,
                cacheHitPct,
              });
            }
          } catch {
            /* yoksay */
          }
        }
        // P1-debug: error response body dump
        if (process.env.ARCHITECT_PROXY_DEBUG) {
          console.log(`[proxy-dbg-resp] url=${url} status=${status} ct=${contentType} ce=${contentEncoding} bytes=${Buffer.concat(captured).length}`);
        }
        if (process.env.ARCHITECT_PROXY_DEBUG && status >= 400) {
          try {
            const buf = Buffer.concat(captured);
            let body = buf;
            if (contentEncoding === "gzip") body = zlib.gunzipSync(buf);
            else if (contentEncoding === "br") body = zlib.brotliDecompressSync(buf);
            else if (contentEncoding === "deflate") body = zlib.inflateSync(buf);
            console.log(`[proxy-dbg-err] url=${url} method=${method} status=${status} body=${body.toString("utf8").slice(0, 800)}`);
          } catch (e) {
            console.log(`[proxy-dbg-err] url=${url} method=${method} status=${status} decode_fail=${(e as Error).message}`);
          }
        }
      });
      upstreamRes.on("error", (e) => {
        console.error("[anthropic-proxy] upstream stream error:", e.message);
        if (!clientRes.writableEnded) clientRes.end();
      });
    },
  );
  upstreamReq.on("error", (e) => {
    console.error("[anthropic-proxy] upstream request error:", e.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "content-type": "text/plain" });
    }
    if (!clientRes.writableEnded) clientRes.end("upstream_error: " + e.message);
  });
  clientReq.on("aborted", () => {
    try {
      upstreamReq.destroy();
    } catch {
      /* yoksay */
    }
  });
  if (bodyBuf.length > 0) upstreamReq.write(bodyBuf);
  upstreamReq.end();
  // didModify sadece debug icin — istenirse log'lanir; sessiz birakiyoruz.
  void didModify;
}

export interface AnthropicProxyHandle {
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

// Fix 52: konsol log'lari stdio:ignore ile child'in stdout'una gidiyordu,
// .log dosyasinda gozukmuyor. Logger callback'i alip proxy diagnostiklerini
// JSON event'i olarak diske yazariz — log analizi mumkun olur.
type ProxyLogger = (msg: string, meta?: Record<string, unknown>) => void;
let proxyLogger: ProxyLogger | null = null;
export function setProxyLogger(fn: ProxyLogger): void {
  proxyLogger = fn;
}
function plog(msg: string, meta?: Record<string, unknown>): void {
  if (proxyLogger) proxyLogger(msg, meta);
  else console.log(`[anthropic-proxy] ${msg}`, meta ?? "");
}

export function startAnthropicProxy(): Promise<AnthropicProxyHandle> {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((e) => {
      console.error("[anthropic-proxy] handler crash:", e);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      if (!res.writableEnded) res.end("proxy_crash: " + (e as Error).message);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("anthropic-proxy: address resolution failed"));
        return;
      }
      const port = addr.port;
      resolve({
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((resv) => {
            server.close(() => resv());
          }),
      });
    });
  });
}
