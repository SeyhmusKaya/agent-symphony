// Nightly report — runs around 04:00 every day, collects the previous day's
// metrics, produces a short summary with Claude Sonnet, writes to an .md file.
//
// To keep the cost low:
//   - Sonnet (not Opus)
//   - max 4000 thinking
//   - Only the previous day's data (not the entire history)
//   - Single query, no tools (disallowedTools = the SDK's full tool list)
//
// Trigger: setInterval checks every 10 min — run if hour == 4 and the last
// report != today. Stays sticky across process restarts because the file name
// is date-based.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { UsageRecord } from "./usage.js";
import { fmtDateTr, fmtDateTimeTr } from "./time.js";

export interface NightlyReportOpts {
  // The LIST of paths like appData/com.seyh.architect/global/usage.json
  // (each project + global). Collects data from all projects.
  usageFiles: string[];
  // Report output directory (appData/com.seyh.architect/global/reports/)
  reportDir: string;
  // Optional logger
  log?: (msg: string, meta?: Record<string, unknown>) => void;
  // For test/manual trigger
  forceRun?: boolean;
  // Optional: list of active projects (id, name, last open ts). If provided,
  // a "stale/idle projects" analysis is added to the report.
  projectsSnapshot?: () => Array<{ id: string; name: string; lastOpened: number }>;
}

function isoDate(d: Date): string {
  // YYYY-MM-DD by Europe/Istanbul time — avoids the UTC drift issue.
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Istanbul",
  }).format(d);
  return parts;
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoDate(d);
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function readUsage(file: string): UsageRecord[] {
  if (!existsSync(file)) return [];
  try {
    const raw = readFileSync(file, "utf8").trim();
    if (!raw) return [];
    return JSON.parse(raw) as UsageRecord[];
  } catch {
    return [];
  }
}

interface AgentAgg {
  agent: string;
  input: number;
  output: number;
  source: string;
}

function aggregateForDay(opts: NightlyReportOpts, dayKey: string): AgentAgg[] {
  const map = new Map<string, AgentAgg>();
  for (const file of opts.usageFiles) {
    const records = readUsage(file).filter((r) => r.date === dayKey);
    const projectLabel = file.includes("/global/") ? "global" : file.split(/[\\/]/).slice(-3, -2)[0] ?? "project";
    for (const r of records) {
      const k = `${projectLabel}/${r.agent}`;
      const ex = map.get(k);
      if (ex) {
        ex.input += r.input;
        ex.output += r.output;
      } else {
        map.set(k, { agent: r.agent, input: r.input, output: r.output, source: projectLabel });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.input + b.output - (a.input + a.output));
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// Detect the system language — returns an IETF locale tag (e.g. "tr-TR", "en-US").
// Returns "en" if it cannot be detected.
function detectLocale(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale && locale.length >= 2) return locale;
  } catch {
    // noop
  }
  // LANG/LANGUAGE env variable (Linux/Mac)
  const env = process.env.LANG ?? process.env.LANGUAGE ?? "";
  if (env.startsWith("tr")) return "tr-TR";
  return "en";
}

// Base language code: "tr-TR" → "tr", "en-US" → "en"
function langCode(locale: string): string {
  return locale.split(/[-_]/)[0].toLowerCase();
}

function buildSummaryPrompt(
  dayKey: string,
  aggs: AgentAgg[],
  staleProjects: Array<{ id: string; name: string; lastOpened: number; dayCount: number }>,
): string {
  const locale = detectLocale();
  const lang = langCode(locale);
  const isTr = lang === "tr";

  const lines = aggs
    .slice(0, 25)
    .map(
      (a) =>
        `- ${a.source}/${a.agent}: in ${fmtTok(a.input)} / out ${fmtTok(a.output)} (total ${fmtTok(a.input + a.output)} token)`,
    )
    .join("\n");
  const total = aggs.reduce((s, a) => s + a.input + a.output, 0);

  const staleBlock = staleProjects.length
    ? staleProjects
        .slice(0, 8)
        .map((p) =>
          isTr
            ? `- ${p.name} (id: ${p.id}) — ${p.dayCount} gündür açılmamış`
            : `- ${p.name} (id: ${p.id}) — not opened for ${p.dayCount} days`,
        )
        .join("\n")
    : isTr
      ? "_uyku modunda proje yok_"
      : "_no stale projects_";

  const dataHeader = isTr
    ? `# Architect günlük performans verisi — ${dayKey}`
    : `# Architect daily performance data — ${dayKey}`;

  const totalLine = isTr
    ? `Toplam: ${fmtTok(total)} token, ${aggs.length} ajan-proje kombinasyonu.`
    : `Total: ${fmtTok(total)} tokens, ${aggs.length} agent-project combinations.`;

  const agentHeader = isTr ? `## Ajan dökümü` : `## Agent breakdown`;
  const staleHeader = isTr
    ? `## Uzun süredir dokunulmamış projeler (14+ gün)`
    : `## Long-idle projects (14+ days)`;

  const langInstruction = isTr
    ? [
        `Yukarıdaki veriye dayanarak TÜRKÇE kısa bir günlük rapor yaz.`,
        `KARAKTER KURALI: ç ş ğ ü ö ı İ Ğ Ü Ö Ş Ç harflerini MUTLAKA doğru kullan.`,
        `"ozet" değil "özet", "gune" değil "güne", "cogu" değil "çoğu" gibi.`,
        `ASCII zorlama kesinlikle yasak — her Türkçe kelimeyi tam doğru yaz.`,
        `Profesyonel ton, akıcı Türkçe.`,
      ]
    : [
        `Based on the above data, write a concise daily report in English.`,
        `Professional tone, clear language.`,
      ];

  // Section headings stay fixed — the UI parser searches for these headings.
  const sections = isTr
    ? [
        `## Özet`,
        `(2-3 cümle: bugün ne yapıldı, hangi proje en yoğundu, dikkat çeken sayılar)`,
        ``,
        `## Performans gözlemleri`,
        `(varsa: ajanların token verimliliği, anormal yüksek/düşük değerler)`,
        ``,
        `## İyileştirme önerileri`,
        `(3-5 madde: bir sonraki gün için SOMUT, UYGULANABİLİR öneri. Her madde tek satır, fiil ile başlasın. Mimar/şef bunu doğrudan delege edebilmeli.)`,
        ``,
        `## Eski proje önerileri`,
        `(yukarıdaki uyku modundaki projeler için: her birine bir iyileştirme/canlandırma önerisi yaz. Yoksa "yok".)`,
        ``,
        `## Sistem için uyarı`,
        `(varsa hata sinyali, bütçe aşımı, vs.; yoksa "yok" yaz)`,
      ]
    : [
        `## Summary`,
        `(2-3 sentences: what was done today, which project was most active, notable numbers)`,
        ``,
        `## Performance observations`,
        `(if any: agent token efficiency, unusually high/low values)`,
        ``,
        `## Improvement suggestions`,
        `(3-5 items: CONCRETE, ACTIONABLE suggestions for next day. One item per line, start with a verb. The architect/chief should be able to delegate directly.)`,
        ``,
        `## Stale project suggestions`,
        `(for each stale project listed above: one improvement/revival suggestion. Write "none" if no stale projects.)`,
        ``,
        `## System warnings`,
        `(any error signals, budget overruns, etc.; write "none" if nothing)`,
      ];

  return [
    dataHeader,
    ``,
    totalLine,
    ``,
    agentHeader,
    lines || (isTr ? "_veri yok_" : "_no data_"),
    ``,
    staleHeader,
    staleBlock,
    ``,
    ...langInstruction,
    `Format:`,
    ``,
    ...sections,
  ].join("\n");
}

async function generateReport(opts: NightlyReportOpts, dayKey: string): Promise<string> {
  const aggs = aggregateForDay(opts, dayKey);
  const locale = detectLocale();
  const isTr = langCode(locale) === "tr";
  if (aggs.length === 0) {
    return isTr
      ? `# ${dayKey} raporu\n\nDün veri yok. Sistem kullanılmadı veya orchestrator kapalıydı.\n`
      : `# ${dayKey} report\n\nNo data for yesterday. System was not used or orchestrator was offline.\n`;
  }
  const now = Date.now();
  const STALE_DAY = 14;
  const projeler = opts.projectsSnapshot?.() ?? [];
  const staleProjects = projeler
    .filter((p) => p.lastOpened && now - p.lastOpened > STALE_DAY * 86_400_000)
    .map((p) => ({
      ...p,
      dayCount: Math.floor((now - p.lastOpened) / 86_400_000),
    }))
    .sort((a, b) => b.dayCount - a.dayCount);
  const prompt = buildSummaryPrompt(dayKey, aggs, staleProjects);
  let result = "";
  try {
    const it = query({
      prompt,
      options: {
        model: "claude-sonnet-4-6",
        maxThinkingTokens: 0,
        // COST SAVING: text-only, none of tools/skills/CLAUDE.md needed.
        tools: [],
        skills: [],
        settingSources: [],
      },
    });
    for await (const msg of it) {
      if (msg.type === "result" && msg.subtype === "success") {
        result = msg.result;
        break;
      }
    }
  } catch (err) {
    result = isTr
      ? `_Rapor üretimi başarısız: ${(err as Error).message}_`
      : `_Report generation failed: ${(err as Error).message}_`;
  }
  if (!result.trim()) {
    result = isTr ? "_Rapor üretimi boş döndü._" : "_Report generation returned empty._";
  }
  const aggBlock = aggs
    .slice(0, 25)
    .map(
      (a) =>
        `| ${a.source} | ${a.agent} | ${fmtTok(a.input)} | ${fmtTok(a.output)} | ${fmtTok(a.input + a.output)} |`,
    )
    .join("\n");
  const reportTitle = isTr
    ? `# Architect Günlük Rapor — ${fmtDateTr(new Date(dayKey).getTime())}`
    : `# Architect Daily Report — ${dayKey}`;
  const rawDataHeader = isTr
    ? `## Ham veri`
    : `## Raw data`;
  return [
    reportTitle,
    ``,
    isTr ? `Oluşturma: ${fmtDateTimeTr(Date.now())}` : `Generated: ${fmtDateTimeTr(Date.now())}`,
    ``,
    result.trim(),
    ``,
    `---`,
    ``,
    rawDataHeader,
    `| Source | Agent | Input | Output | Total |`,
    `|---|---|---:|---:|---:|`,
    aggBlock,
    ``,
  ].join("\n");
}

function reportPath(reportDir: string, dayKey: string): string {
  return join(reportDir, `${dayKey}.md`);
}

export async function runNightlyReportNow(opts: NightlyReportOpts, dayKey?: string): Promise<string> {
  const d = dayKey ?? yesterdayKey();
  ensureDir(opts.reportDir);
  const out = reportPath(opts.reportDir, d);
  if (existsSync(out) && !opts.forceRun) {
    opts.log?.("nightly_skip_exists", { day: d, path: out });
    return out;
  }
  opts.log?.("nightly_start", { day: d });
  const report = await generateReport(opts, d);
  writeFileSync(out, report, "utf8");
  opts.log?.("nightly_done", { day: d, path: out, bytes: report.length });
  return out;
}

let intervalRef: NodeJS.Timeout | null = null;

export function startNightlyReport(opts: NightlyReportOpts): () => void {
  // 1) Periodic tick (10 min): if hour 04:00 + no report for today → generate.
  // 2) STARTUP CATCH-UP: when the orchestrator starts, check the last 3 days'
  //    reports — generate immediately if any are missing. So if the computer was
  //    off overnight, it auto-creates yesterday's report on first launch.
  let inFlight = false;

  const runIfMissing = async (dayKey: string): Promise<void> => {
    if (existsSync(reportPath(opts.reportDir, dayKey))) return;
    if (inFlight) return;
    inFlight = true;
    try {
      opts.log?.("nightly_catchup_start", { day: dayKey });
      await runNightlyReportNow(opts, dayKey);
    } catch (err) {
      opts.log?.("nightly_error", { day: dayKey, error: (err as Error).message });
    } finally {
      inFlight = false;
    }
  };

  const tick = async () => {
    const now = new Date();
    if (now.getHours() !== 4) return;
    await runIfMissing(yesterdayKey());
  };

  intervalRef = setInterval(tick, 10 * 60 * 1000); // 10 min

  // Startup catch-up — check the last 3 days (the PC may have been off).
  // Generate previous days oldest → newest so the natural order is preserved.
  void (async () => {
    const today = new Date();
    const missing: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = isoDate(d);
      if (!existsSync(reportPath(opts.reportDir, key))) missing.push(key);
    }
    // Oldest → newest order
    missing.reverse();
    if (missing.length) {
      opts.log?.("nightly_startup_missing", { gun_sayisi: missing.length, gunler: missing });
    }
    for (const day of missing) {
      await runIfMissing(day);
    }
  })();

  return () => {
    if (intervalRef) {
      clearInterval(intervalRef);
      intervalRef = null;
    }
  };
}

export function listReports(reportDir: string): { date: string; path: string; size: number }[] {
  if (!existsSync(reportDir)) return [];
  return readdirSync(reportDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const p = join(reportDir, f);
      const stat = (() => {
        try {
          return readFileSync(p, "utf8").length;
        } catch {
          return 0;
        }
      })();
      return { date: f.replace(/\.md$/, ""), path: p, size: stat };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
