import type { UsageTracker } from "./usage.js";
import type { AuditLog } from "./audit.js";
import { fmtDateTr } from "./time.js";

const EVENT_LABEL: Record<string, string> = {
  delege_basladi: "Delege",
  worker_spawn: "Worker",
  commit: "Commit",
  hata: "Hata",
  peer_istek: "Uzman istegi",
  dosya_degisti: "Dosya degisikligi",
};

export function dailyReport(usage: UsageTracker, audit: AuditLog): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const since = start.getTime();

  const events = audit.all().filter((e) => e.ts >= since);
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;

  const t = usage.totalToday();
  const lines = [
    `Gunluk Rapor — ${fmtDateTr(start.getTime())}`,
    `Token: girdi ${t.input}, cikti ${t.output}, toplam ${t.input + t.output}`,
    `Toplam olay: ${events.length}`,
  ];
  for (const [type, n] of Object.entries(counts)) {
    lines.push(`  ${EVENT_LABEL[type] ?? type}: ${n}`);
  }
  return lines.join("\n");
}
