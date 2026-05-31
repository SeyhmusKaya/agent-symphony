// M36/M37: SDK hooks for token economy.
//
// - PreToolUse: per-turn tool count cap. Prevents runaway 40-100+ tool turns.
// - PostToolUse: truncates large Bash/Read/Grep/Glob outputs (RTK-style:
//   head + tail + "[N chars truncated]" middle). Saves 30-70% input tokens
//   on noisy commands.
//
// Used by main.ts (chief), specialist.ts, worker.ts, task.ts.

const DEFAULT_TOOL_LIMIT = 12;
const DEFAULT_OUTPUT_CAP = 6000;

// Fix 133: WebFetch/WebSearch sonuclari ham sayfa (50-200k char) donduruyordu
// ve compress listesinde DEGILDI → context patlamasi (google_yorum: messages
// 1M token, ~4.1M char). Listeye eklendi. Web tool'lari icin daha yuksek cap
// (WEB_OUTPUT_CAP) — dokuman/sayfa icerigi okunabilsin ama ham HTML bloat
// kesilsin (head+tail). Diger tool'lar normal outputCap (3000) ile kalir.
const WEB_TOOLS = new Set(["WebFetch", "WebSearch"]);
const WEB_OUTPUT_CAP = 12000;

// KOK FIX (token bloat): Read/Grep/Glob dosya-icerik tool'lari. Builtin Read
// tek cagrida tam dosyayi (Read'in kendi cap'i ~25k token) context'e koyuyordu;
// outputCap (3000 char ~40 satir) cok kucuk olunca model dosyayi goremeyip
// re-Read ediyor. READ_OUTPUT_CAP ~130 satirlik makul ust sinir: gercek
// calismaya yeter, 95k-char canavar Read'i ~10x kuculur. Ranged Read zaten
// kucuk doner.
const FILE_READ_TOOLS = new Set(["Read", "Grep", "Glob"]);
const READ_OUTPUT_CAP = 10000;

const TARGET_COMPRESS_TOOLS = new Set([
  "Bash",
  "Read",
  "Grep",
  "Glob",
  "BashOutput",
  "WebFetch",
  "WebSearch",
  // MCP tool sonuclari da (task subprocess, spawn_worker, delegate, talk_to_chief)
  // — task ozellikle 10-30k geri donuyor, sef context'ini sisiriyor.
  "mcp__architect__task",
  "mcp__architect__spawn_worker",
  "mcp__architect__spawn_workers_parallel",
  "mcp__architect__delegate",
  "mcp__architect__talk_to_chief",
  "mcp__architect__note_list",
  "mcp__architect__list_agents",
  "mcp__architect__list_projects",
  "mcp__architect__read_logs",
  "mcp__architect__log_search",
  "mcp__architect__audit_search",
]);

function truncate(text: string, cap: number): string {
  if (!text || text.length <= cap) return text;
  const head = text.slice(0, Math.floor(cap * 0.6));
  const tail = text.slice(-Math.floor(cap * 0.3));
  const removed = text.length - head.length - tail.length;
  return `${head}\n\n[... ${removed} kar kisaltildi ...]\n\n${tail}`;
}

// F6 (master plan 2026): Bash ile kod-dosyasi grep/find/rg/ag yakalandiginda
// nudge enjekte et — engelleme yok, sadece sef'e CodeGraph hatirlatmasi.
// Fix 106 sonrasi canUseTool deny pek cok pattern'i kacirir; bu PostToolUse
// nudge gecmis tool sonucuna eklenir, sef sonraki tur okuyup yonelir.
const CODEGRAPH_NUDGE_RX =
  /\b(grep|rg|ag|find|cat|head|tail|less|more)\b[^|]*\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|svelte|py|go|rs|java|c|cpp|h|hpp|cs|rb|php)\b/i;
const CODEGRAPH_NUDGE_MSG =
  "[CODEGRAPH HATIRLATMASI] Bu sorgu CodeGraph code_search ile cok daha hizli + index'li olur (FTS5 ~50ms, ~200 token). Bash grep/cat yerine bir sonraki turda code_search/code_callers/code_node/code_files tercih et.";

// F6 (token maliyet): tam-dosya Read kod dosyasinda yakalandiginda nudge.
// Read 555x vs code_search 120x -> okumalar codegraph'tan degil, ham Read'ten;
// her tam dosya context'e giriyor (380k context -> her ic LLM cagrisinda cache-
// read). Engelleme YOK (Fix 122 hard-deny sorunluydu) — sadece hatirlatma.
const CODE_FILE_RX =
  /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|svelte|py|go|rs|java|c|cpp|h|hpp|cs|rb|php|razor)$/i;
const CODEGRAPH_NUDGE_READ_MSG =
  "[CODEGRAPH HATIRLATMASI] Tam dosya Read pahali — tum icerik context'e girer (uzun turda her LLM cagrisinda tekrar cache-read). Sonraki sefer: code_search/code_node ile sembolu + satir araligini bul, sonra Read'i offset/limit ile YALNIZ gerekli araliga uygula. Kucuk config/doc dosyalar bu kapsamda degil.";

// ----- CodeGraph DAR enforcement (Fix 147) -----
// Sorun: code_search CORE'da + system prompt "once code_search" diyor ama model
// training prior (Claude Code: kod=grep refleksi) yuzunden HEP grep/cat kullaniyor
// (olculdu: code_search 1 vs Bash 1449 / Read 308 / Grep 36). Soft yonerge
// training bias'i yenmiyor. Cozum: KOD DOSYASINDA grep/cat'i — code_search
// DENENMEDEN — reddet+yonlendir. Fix 122'nin geniS-deny hatasini tekrarlamamak
// icin: (1) yalniz kod-uzantili hedefte, (2) code_search bu turda kullanildiysa
// SERBEST (fallback), (3) ardarda 3 deny'den sonra SERBEST (stuck korumasi).
const CODE_TOOL_RX =
  /(?:^|__)code_(search|node|callers|callees|impact|imports|files|stats)\b/;
// Grep tool kod hedefliyor mu (glob/path/type kod uzantisi)?
const CODE_TYPE_SET = new Set([
  "ts", "tsx", "js", "jsx", "py", "go", "rust", "rs", "java",
  "c", "cpp", "cs", "rb", "php", "svelte",
]);
// KOK FIX: glob icinde kod uzantisi TOKEN'i (brace-glob {tsx,ts} dahil) — eski
// CODE_FILE_RX trailing-$ bekliyordu, "*.{tsx,ts,css}" kaciyordu. css/json/sql
// (codegraph indekslemez, text arama mesru) deny edilmez — yalniz kod uzantisi.
const CODE_GLOB_TOKEN_RX =
  /\b(tsx|jsx|svelte|mjs|cjs|mts|cts|py|go|rs|rb|php|java|cpp|hpp|razor)\b|\.(ts|js|cs|c|h)\b/i;
function grepTargetsCode(ti: {
  glob?: string;
  path?: string;
  type?: string;
}): boolean {
  if (ti.type && CODE_TYPE_SET.has(ti.type)) return true;
  if (ti.glob && CODE_GLOB_TOKEN_RX.test(ti.glob)) return true;
  if (ti.path && (CODE_FILE_RX.test(ti.path) || CODE_GLOB_TOKEN_RX.test(ti.path))) return true;
  return false;
}
const CODEGRAPH_DENY_MSG =
  "[CODEGRAPH ZORUNLU] Kod dosyasinda grep/cat/find reddedildi. ONCE code_search(query) ile sembolu bul (FTS5, ~50ms ~200 token), gerekirse code_node/code_callers/code_callees/code_impact. code_search 0 sonuc dondururse VEYA plain-text/pattern (TODO/string) ariyorsan o zaman grep serbest — tekrar dene, izin verilecek. Tam-dosya yerine code_node ile satir araligi bulup Read(offset,limit) yap.";
const CODEGRAPH_DENY_MAX = 3; // ardarda bu kadar deny'den sonra serbest (stuck korumasi)

function appendNudge(val: unknown, msg: string): unknown {
  if (typeof val === "string") return val + "\n\n" + msg;
  if (Array.isArray(val)) {
    // Anthropic SDK content array: [{type:"text", text:"..."}]
    const cloned = [...val];
    const last = cloned[cloned.length - 1];
    if (last && typeof last === "object" && "text" in (last as object)) {
      cloned[cloned.length - 1] = {
        ...(last as object),
        text: String((last as { text: unknown }).text) + "\n\n" + msg,
      };
    } else {
      cloned.push({ type: "text", text: msg });
    }
    return cloned;
  }
  if (val && typeof val === "object") {
    const o = val as Record<string, unknown>;
    const out: Record<string, unknown> = { ...o };
    if (typeof out.output === "string") out.output = out.output + "\n\n" + msg;
    else if (typeof out.stdout === "string") out.stdout = out.stdout + "\n\n" + msg;
    else if ("content" in out) out.content = appendNudge(out.content, msg);
    else out.codegraph_hint = msg;
    return out;
  }
  return { value: val, codegraph_hint: msg };
}

function compressAny(val: unknown, cap: number): unknown {
  if (typeof val === "string") return truncate(val, cap);
  if (Array.isArray(val)) {
    return val.map((v) =>
      v && typeof v === "object" && "text" in (v as object)
        ? { ...(v as object), text: truncate(String((v as { text: unknown }).text), cap) }
        : v,
    );
  }
  if (val && typeof val === "object") {
    const o = val as Record<string, unknown>;
    const out: Record<string, unknown> = { ...o };
    // KOK FIX (token bloat): builtin Read tool_response sekli
    //   { type:"text", file:{ filePath, content:"<TUM DOSYA>", numLines, ... } }
    // — content TOP-LEVEL DEGIL, file.content icinde NESTED. Eski liste sadece
    // top-level output/stdout/content bakiyordu -> Read HIC kesilmiyordu (95k char
    // = 36k token tek tool_result). Bash {stdout} kesiliyordu, Read kesilmiyordu.
    // Bu yuzden "2-3 promptta 200k context" oluyordu. Simdi file.content + text
    // de kesiliyor.
    if (out.file && typeof out.file === "object") {
      const f = out.file as Record<string, unknown>;
      if (typeof f.content === "string") {
        out.file = { ...f, content: truncate(f.content, cap) };
      }
    }
    for (const key of ["output", "stdout", "content", "text"]) {
      if (key in out) out[key] = compressAny(out[key], cap);
    }
    return out;
  }
  return val;
}

export interface EconomyHooksOpts {
  /** Per-turn tool call hard limit. Default 12. Pass 0 to disable cap. */
  toolLimit?: number;
  /** Char cap for Bash/Read/Grep outputs. Default 6000. Pass 0 to disable. */
  outputCap?: number;
  /** Label for permission denial messages. Default "Ajan". */
  label?: string;
}

/**
 * Returns SDK `hooks` object enforcing tool count cap + Bash output compress.
 * Stateful per call (turnToolCount closure) — call fresh per query().
 */
export function buildEconomyHooks(opts: EconomyHooksOpts = {}) {
  const toolLimit = opts.toolLimit ?? DEFAULT_TOOL_LIMIT;
  const outputCap = opts.outputCap ?? DEFAULT_OUTPUT_CAP;
  const label = opts.label ?? "Ajan";
  let turnToolCount = 0;
  // Fix 147: CodeGraph dar enforcement durumu (closure, query basina taze).
  let usedCodegraph = false; // bu turda code_* tool kullanildi mi
  let codegraphDenyCount = 0; // ardarda deny sayaci (stuck korumasi)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hooks: Record<string, unknown[]> = {};

  // Fix 147: PreToolUse HER ZAMAN var (toolLimit=0 sef dahil). Iki gorev:
  //   (A) CodeGraph dar enforcement: kod dosyasinda grep/cat/find'i code_search
  //       denenmeden reddet+yonlendir (training prior'i kirmak icin; soft yetmedi).
  //   (B) toolLimit>0 ise per-turn tool sayisi cap'i (runaway turleri onler).
  // Fix 122 geniS-deny hatasi tekrarlanmaz: yalniz kod-uzantili hedef + code_search
  // sonrasi serbest + 3 deny sonrasi serbest (fallback/stuck korumasi).
  hooks.PreToolUse = [
    {
      hooks: [
        async (input: unknown) => {
          const h = input as {
            tool_name?: string;
            tool_input?: {
              command?: string;
              glob?: string;
              path?: string;
              type?: string;
            };
          };
          const toolName = h.tool_name ?? "?";

          // code_* tool kullanildiysa bu turda fallback'e izin ver.
          if (CODE_TOOL_RX.test(toolName)) usedCodegraph = true;

          // (A) CodeGraph enforcement — yalniz code_search HENUZ kullanilmadiysa
          // ve deny limiti asilmadiysa.
          if (!usedCodegraph && codegraphDenyCount < CODEGRAPH_DENY_MAX) {
            let codeTargeted = false;
            if (toolName === "Bash" && h.tool_input?.command) {
              codeTargeted = CODEGRAPH_NUDGE_RX.test(h.tool_input.command);
            } else if (toolName === "Grep" && h.tool_input) {
              codeTargeted = grepTargetsCode(h.tool_input);
            }
            if (codeTargeted) {
              codegraphDenyCount++;
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse" as const,
                  permissionDecision: "deny" as const,
                  permissionDecisionReason: CODEGRAPH_DENY_MSG,
                },
              };
            }
          }

          // (B) per-turn tool sayisi cap'i (yalniz toolLimit>0).
          if (toolLimit > 0) {
            turnToolCount++;
            if (turnToolCount > toolLimit) {
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse" as const,
                  permissionDecision: "deny" as const,
                  permissionDecisionReason: `[TOOL LIMITI] ${label} bu turda ${toolLimit} tool sinirina ulasti (${toolName} reddedildi). Eldeki bilgiyle 1-3 cumlede sentezleyip turu bitir.`,
                },
              };
            }
          }
          return { continue: true };
        },
      ],
    },
  ];

  if (outputCap > 0) {
    hooks.PostToolUse = [
      {
        hooks: [
          async (input: unknown) => {
            const h = input as {
              tool_name?: string;
              tool_input?: {
                command?: string;
                file_path?: string;
                offset?: number;
                limit?: number;
              };
              tool_response?: unknown;
            };
            // F6: Bash kod-dosyasi grep/find/rg/ag/cat yakaland mi? Nudge enjekte et.
            // Engelleme yok — sadece bir sonraki tur icin sef'e CodeGraph hatirlat.
            let nudge: string | null = null;
            if (h.tool_name === "Bash" && h.tool_input?.command) {
              if (CODEGRAPH_NUDGE_RX.test(h.tool_input.command)) {
                nudge = CODEGRAPH_NUDGE_MSG;
              }
            } else if (h.tool_name === "Read" && h.tool_input?.file_path) {
              // Tam-dosya (offset/limit YOK) kod dosyasi okuma -> nudge. Ranged
              // Read (offset|limit verilmis) zaten dogru kullanim -> nudge yok.
              const ranged =
                h.tool_input.offset != null || h.tool_input.limit != null;
              if (!ranged && CODE_FILE_RX.test(h.tool_input.file_path)) {
                nudge = CODEGRAPH_NUDGE_READ_MSG;
              }
            }
            if (!h.tool_name || !TARGET_COMPRESS_TOOLS.has(h.tool_name)) {
              if (nudge) {
                return {
                  hookSpecificOutput: {
                    hookEventName: "PostToolUse" as const,
                    updatedToolOutput: appendNudge(h.tool_response, nudge),
                  },
                };
              }
              return { continue: true };
            }
            // Fix 133: web tool'larina daha yuksek cap — sayfa icerigi okunsun,
            // ham HTML bloat (50-200k) kesilsin. outputCap 0 ise (cap kapali)
            // web cap'i de uygulanmaz.
            // KOK FIX: Read/Grep/Glob dosya-icerik tool'larina ORTA cap
            // (READ_OUTPUT_CAP) — outputCap (3000=~40 satir) cok agresifti, model
            // dosyayi goremeyip surekli re-Read ediyordu. READ_OUTPUT_CAP ~130
            // satir: gercek calismaya yeter, 95k canavar Read'i ~10x kuculur.
            // Ranged Read (offset/limit) zaten kucuk doner; bu cap tam-dosya
            // Read'in ust sinirini koyar.
            let cap = outputCap;
            if (outputCap > 0) {
              if (WEB_TOOLS.has(h.tool_name)) cap = Math.max(outputCap, WEB_OUTPUT_CAP);
              else if (FILE_READ_TOOLS.has(h.tool_name)) cap = Math.max(outputCap, READ_OUTPUT_CAP);
            }
            let out = compressAny(h.tool_response, cap);
            if (nudge) out = appendNudge(out, nudge);
            return {
              hookSpecificOutput: {
                hookEventName: "PostToolUse" as const,
                updatedToolOutput: out,
              },
            };
          },
        ],
      },
    ];
  }

  return hooks;
}
