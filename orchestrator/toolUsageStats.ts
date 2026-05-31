// Tool kullanim telemetrisi — her turun sonunda toplam call sayilari +
// hata orani + son kullanim zamani yazilir. Mimar gece taramasinda veya
// kullanici raporlamada "0 cagrili" tool'lari core'dan cikarabilir.
//
// Dosya formati:
// {
//   "tool_adi": {
//     "count": 42,
//     "errors": 3,
//     "lastUsed": 1700000000000,
//     "agents": { "Mimar": 30, "ProjeSefi:X": 12 }
//   },
//   ...
// }

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface ToolStat {
  count: number;
  errors: number;
  lastUsed: number;
  agents: Record<string, number>;
}

export interface ToolUsageInput {
  ad: string;
  hata: boolean;
}

export class ToolUsageStats {
  private filePath: string;
  private data: Record<string, ToolStat> = {};

  constructor(filePath: string) {
    this.filePath = filePath;
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, "utf8").trim();
        if (raw) this.data = JSON.parse(raw);
      } catch {
        this.data = {};
      }
    }
  }

  // Bir turun aktivite listesini topluca yaz. agent: "Mimar" | "ProjeSefi:<ad>" | "Danisman:<ad>"
  recordTurn(agent: string, tools: readonly ToolUsageInput[]): void {
    if (!tools.length) return;
    const now = Date.now();
    for (const t of tools) {
      if (!t.ad) continue;
      const rec = this.data[t.ad] ?? {
        count: 0,
        errors: 0,
        lastUsed: 0,
        agents: {},
      };
      rec.count += 1;
      if (t.hata) rec.errors += 1;
      rec.lastUsed = now;
      rec.agents[agent] = (rec.agents[agent] ?? 0) + 1;
      this.data[t.ad] = rec;
    }
    this.save();
  }

  // Belirli tool'un istatistigi.
  get(toolName: string): ToolStat | null {
    return this.data[toolName] ?? null;
  }

  // Tum tool'lar — count buyukten kucuge.
  all(): Array<{ ad: string } & ToolStat> {
    return Object.entries(this.data)
      .map(([ad, s]) => ({ ad, ...s }))
      .sort((a, b) => b.count - a.count);
  }

  // En cok kullanilan ilk N.
  top(n: number): Array<{ ad: string } & ToolStat> {
    return this.all().slice(0, n);
  }

  // Hic kullanilmamis (bu store'da kaydi olmayan) tool isimleri.
  // bilinen liste argumentinden alinmali.
  unused(known: readonly string[]): string[] {
    return known.filter((t) => !this.data[t]);
  }

  // En son N gun icinde kullanilmamislari listele.
  staleSince(gunSayisi: number, known: readonly string[]): string[] {
    const cutoff = Date.now() - gunSayisi * 24 * 60 * 60 * 1000;
    const out: string[] = [];
    for (const t of known) {
      const rec = this.data[t];
      if (!rec) {
        out.push(t);
        continue;
      }
      if (rec.lastUsed < cutoff) out.push(t);
    }
    return out;
  }

  // Insan okur ozet.
  summary(): string {
    const all = this.all();
    if (!all.length) return "(henuz tool kullanim verisi yok)";
    const lines: string[] = [];
    lines.push(`Toplam farkli tool: ${all.length}`);
    const sumCalls = all.reduce((s, r) => s + r.count, 0);
    const sumErr = all.reduce((s, r) => s + r.errors, 0);
    lines.push(`Toplam cagri: ${sumCalls} | hata: ${sumErr} (%${((sumErr / Math.max(1, sumCalls)) * 100).toFixed(1)})`);
    lines.push("");
    lines.push("En cok kullanilan 10 tool:");
    for (const r of all.slice(0, 10)) {
      const errPct = r.count ? `${((r.errors / r.count) * 100).toFixed(0)}%` : "0%";
      lines.push(`  ${r.ad.padEnd(28)} ${String(r.count).padStart(5)} cagri  hata ${errPct}`);
    }
    return lines.join("\n");
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }
}
