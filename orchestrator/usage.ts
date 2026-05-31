import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface TokenUsage {
  input: number;
  output: number;
}

export interface UsageRecord {
  agent: string;
  date: string;
  input: number;
  output: number;
}

export type Period = "gun" | "hafta" | "ay";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class UsageTracker {
  private filePath: string;
  private records: UsageRecord[] = [];
  private dailyLimit: number;

  constructor(filePath: string, dailyLimit = 0) {
    this.filePath = filePath;
    this.dailyLimit = dailyLimit;
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8").trim();
      if (raw) this.records = JSON.parse(raw) as UsageRecord[];
    }
  }

  overBudget(): boolean {
    if (this.dailyLimit <= 0) return false;
    const t = this.totalToday();
    return t.input + t.output > this.dailyLimit;
  }

  record(agent: string, usage: TokenUsage): void {
    const date = today();
    let rec = this.records.find((r) => r.agent === agent && r.date === date);
    if (!rec) {
      rec = { agent, date, input: 0, output: 0 };
      this.records.push(rec);
    }
    rec.input += usage.input;
    rec.output += usage.output;
    this.save();
  }

  total(): TokenUsage {
    return this.sum(this.records);
  }

  totalToday(): TokenUsage {
    const date = today();
    return this.sum(this.records.filter((r) => r.date === date));
  }

  byAgent(): Record<string, TokenUsage> {
    const out: Record<string, TokenUsage> = {};
    for (const r of this.records) {
      const cur = out[r.agent] ?? { input: 0, output: 0 };
      out[r.agent] = { input: cur.input + r.input, output: cur.output + r.output };
    }
    return out;
  }

  aggregate(period: Period): TokenUsage {
    const cutoff = new Date();
    if (period === "gun") cutoff.setDate(cutoff.getDate() - 1);
    else if (period === "hafta") cutoff.setDate(cutoff.getDate() - 7);
    else cutoff.setMonth(cutoff.getMonth() - 1);
    const limit = cutoff.toISOString().slice(0, 10);
    return this.sum(this.records.filter((r) => r.date >= limit));
  }

  private sum(records: UsageRecord[]): TokenUsage {
    return records.reduce(
      (acc, r) => ({ input: acc.input + r.input, output: acc.output + r.output }),
      { input: 0, output: 0 },
    );
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.records, null, 2), "utf8");
  }
}

// Madde 2 & 3 — Sef delege orani + batch verimliligi.
// Her sef turunun sonunda bir kayit yazilir. usage.json semasini bozmamak
// icin ayri dosyada tutulur (Rust tarafindaki UsageRecord deser etkilenmez).
export type ToolKaynak = "sef" | "delegate" | "task" | "spawn_worker" | "other";

export interface TurnMetric {
  ts: number;                    // epoch ms
  agent: string;                 // "Mimar" | "ProjeSefi:<ad>"
  sef: number;
  delegate: number;
  task: number;
  spawn_worker: number;
  other: number;
  tool_count: number;            // toplam tool cagrisi
  round_count: number;           // assistant mesaji icinde tool_use barindiran round sayisi
}

export class TurnMetricsTracker {
  private filePath: string;
  private records: TurnMetric[] = [];
  // Disk yazimini sinirla — sef her tur sonunda yazar. Cok eski kayitlari
  // (>30 gun) at, dosya sismesin.
  private maxAgeMs = 30 * 24 * 60 * 60 * 1000;

  constructor(filePath: string) {
    this.filePath = filePath;
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, "utf8").trim();
        if (raw) this.records = JSON.parse(raw) as TurnMetric[];
      } catch {
        this.records = [];
      }
    }
  }

  record(turn: Omit<TurnMetric, "ts"> & { ts?: number }): void {
    const ts = turn.ts ?? Date.now();
    this.records.push({ ...turn, ts });
    // Eski kayitlari at.
    const cutoff = Date.now() - this.maxAgeMs;
    if (this.records.length > 200 && this.records[0]!.ts < cutoff) {
      this.records = this.records.filter((r) => r.ts >= cutoff);
    }
    this.save();
  }

  // Son windowMs icindeki delege orani (% delege / toplam tool).
  getDelegationRate(windowMs: number): { oran: number; toplam: number; delege: number } {
    const cutoff = Date.now() - windowMs;
    let toplam = 0;
    let delege = 0;
    for (const r of this.records) {
      if (r.ts < cutoff) continue;
      toplam += r.tool_count;
      delege += r.delegate + r.task + r.spawn_worker;
    }
    const oran = toplam > 0 ? (delege / toplam) * 100 : 0;
    return { oran, toplam, delege };
  }

  // Son windowMs icindeki ortalama tool/round orani.
  getBatchEfficiency(windowMs: number): { oran: number; turlar: number } {
    const cutoff = Date.now() - windowMs;
    let toolSum = 0;
    let roundSum = 0;
    let turlar = 0;
    for (const r of this.records) {
      if (r.ts < cutoff) continue;
      if (r.round_count <= 0) continue;
      toolSum += r.tool_count;
      roundSum += r.round_count;
      turlar += 1;
    }
    const oran = roundSum > 0 ? toolSum / roundSum : 0;
    return { oran, turlar };
  }

  // Son N turun ozeti — sparkline icin.
  recent(n: number): TurnMetric[] {
    return this.records.slice(-n);
  }

  all(): readonly TurnMetric[] {
    return this.records;
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.records, null, 2), "utf8");
  }
}

// Tool adini delege kategorisine eslestir.
export function kaynakBelirle(toolAdi: string): ToolKaynak {
  const ad = toolAdi.toLowerCase();
  if (ad === "delegate" || ad === "background_delegate") return "delegate";
  if (ad === "task") return "task";
  if (ad === "spawn_worker" || ad === "spawn_workers_parallel") return "spawn_worker";
  if (!ad) return "other";
  return "sef";
}
