// orchestrator/budgetManager.ts — F4 Maliyet Kontrol cekirdek.
//
// Amac:
//   - Her ajan icin gunluk USD cap (uzman=$5, sef=$20, mimar=$50).
//   - Hourly burn-rate alarmi (rolling 1h > $X uyari).
//   - Cap'in %80'ine ulasildiginda auto-fallback: opus -> sonnet-4-6.
//     (Fix 104: "fast" service tier su an Anthropic SDK uzerinden 404 doner;
//      gercek 'fast' fallback'i F4'un servisleri olgunlasinca eklenecek.
//      Su an "ucuza in" fallback'i = sonnet-4-6 — opus[1m]'den 5x ucuz,
//      kalite kaybi var ama maliyet duvarinda devamliligi saglar.)
//   - Persistence: paths.team altinda "budgets.json" (proje-local).
//   - Daily reset: gunluk toplamlar tarih degisince sifirlanir; saatlik
//     bucket ring-buffer her insertion'da 1h+ eskileri eler.
//
// Status payload icine getReport() konur — UI BudgetCard bunu cizer.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type BudgetRole = "chief" | "mimar" | "specialist" | "advisor" | "worker";

export interface BudgetConfig {
  perAgentDailyUsd: number;     // uzman/worker varsayilan cap
  perChiefDailyUsd: number;     // proje sefi cap
  perMimarDailyUsd: number;     // global mimar cap
  hourlyBurnAlarmUsd: number;   // rolling 1h burn esigi
  fallbackThresholdPct: number; // 0..1, default 0.80
  // Cap %80 asilinca opus->sonnet otomatik dusurme. VARSAYILAN KAPALI:
  // kullanici sag ustte acikca bir model sectiyse, sistem onu sessizce
  // degistirmemeli (kafa karistirici "neden sonnet cevap verdi" sorunu).
  // Butce yine takip edilir + UI'da gosterilir; sadece otomatik model
  // degisimi opt-in. Acmak icin set_budget_cap/config veya UI ileride.
  autoFallbackEnabled: boolean;
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  perAgentDailyUsd: 5,
  perChiefDailyUsd: 20,
  perMimarDailyUsd: 50,
  hourlyBurnAlarmUsd: 10,
  fallbackThresholdPct: 0.8,
  autoFallbackEnabled: false,
};

interface DailyEntry {
  usd: number;
  date: string; // YYYY-MM-DD (local)
}

interface PersistShape {
  config: BudgetConfig;
  dailyTotals: Array<[string, DailyEntry]>;
}

export interface AgentBudgetStatus {
  agent: string;
  usd: number;
  capUsd: number;
  pctUsed: number;
  exceeded: boolean;
  atWarning: boolean; // pctUsed >= fallbackThresholdPct
}

export interface BudgetReport {
  config: BudgetConfig;
  // Tum bilinen ajanlarin gunluk durumu.
  agents: AgentBudgetStatus[];
  // En cok harcayan 5 (sonsuz UI listesi yerine ozet).
  topSpenders: AgentBudgetStatus[];
  // Rolling 1h burn — toplam (tum ajanlar).
  hourlyBurnUsd: number;
  hourlyAlarm: boolean;
  // Bugun toplam harcanan (tum ajanlar) — UI ozet rozet.
  todayTotalUsd: number;
}

function localDate(d = new Date()): string {
  // ISO YYYY-MM-DD local; gunluk reset icin local-day kullaniyoruz.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export class BudgetManager {
  private config: BudgetConfig;
  private filePath: string;
  // agentName -> last daily entry (sadece bugune ait olani saklariz; tarih
  // degisirse sifirlanir).
  private daily = new Map<string, DailyEntry>();
  // agentName -> son 1h icindeki (ts, usd) kayitlari. Insertion'da 1h+ eski
  // kayitlar elenir; bos kalan key map'ten silinmez (kucuk overhead).
  private hourly = new Map<string, Array<{ ts: number; usd: number }>>();
  // agentName -> role esitlemesi. Cap hesabi icin role gerekir; recordSpend
  // her cagrida role parametresini saklar.
  private roles = new Map<string, BudgetRole>();
  // Disk yazimini debounce: 30sn bekle, ardisik recordSpend'lerde tek save.
  private saveTimer: NodeJS.Timeout | null = null;
  // Fallback bildirim throttle — ayni agent icin tekrar tekrar yayma.
  private notifiedFallback = new Set<string>();

  constructor(filePath: string, config: Partial<BudgetConfig> = {}) {
    this.filePath = filePath;
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...config };
    this.load();
  }

  // ---- Public API ----

  /** Bir ajanin gunluk toplamina + saatlik bucket'ina USD ekler. */
  recordSpend(agentName: string, role: BudgetRole, usd: number): void {
    if (!agentName || !Number.isFinite(usd) || usd <= 0) return;
    this.roles.set(agentName, role);
    const today = localDate();
    const prev = this.daily.get(agentName);
    if (!prev || prev.date !== today) {
      this.daily.set(agentName, { usd, date: today });
    } else {
      prev.usd += usd;
    }
    // Hourly bucket: cutoff 1h.
    const now = Date.now();
    const arr = this.hourly.get(agentName) ?? [];
    arr.push({ ts: now, usd });
    const cutoff = now - 60 * 60 * 1000;
    while (arr.length && arr[0]!.ts < cutoff) arr.shift();
    this.hourly.set(agentName, arr);
    this.scheduleSave();
    // Threshold gecisi UI bildirimi — tek seferlik bayrak.
    const status = this.getDailyStatus(agentName, role);
    if (status.atWarning && !this.notifiedFallback.has(agentName)) {
      this.notifiedFallback.add(agentName);
      // Sahibi notify etmesin — sahibi main.ts; bu sinif sessiz. Sef tarafinda
      // shouldFallbackToCheaperModel() kontrolu yapildiginda emit edilir.
    }
    if (!status.atWarning) {
      this.notifiedFallback.delete(agentName);
    }
  }

  /** Belirli bir ajan icin gunluk USD + cap + %. */
  getDailyTotal(agentName: string, role: BudgetRole): AgentBudgetStatus {
    return this.getDailyStatus(agentName, role);
  }

  /** Son 60dk icinde bu ajanin harcadigi toplam USD. */
  getHourlyBurn(agentName: string): number {
    const arr = this.hourly.get(agentName);
    if (!arr || arr.length === 0) return 0;
    const cutoff = Date.now() - 60 * 60 * 1000;
    let sum = 0;
    for (const e of arr) if (e.ts >= cutoff) sum += e.usd;
    return sum;
  }

  /**
   * Bu ajan icin auto-fallback gerekir mi? Yalniz opus modelleri icin true
   * doner (sonnet/haiku zaten ucuz). Cap %80 esigi asilmis olmali.
   */
  shouldFallbackToCheaperModel(
    agentName: string,
    role: BudgetRole,
    currentModel: string,
  ): boolean {
    // Opt-in: varsayilan kapali. Kullanicinin acikca sectigi modeli sessizce
    // degistirme — "neden sonnet cevap verdi" surprizi olmasin. Butce yine
    // takip + UI'da gosterilir; sadece otomatik model dusurme opsiyonel.
    if (!this.config.autoFallbackEnabled) return false;
    if (!/claude-opus/i.test(currentModel)) return false;
    const s = this.getDailyStatus(agentName, role);
    return s.atWarning;
  }

  /** UI status payload icin per-agent + top-5 ozet. */
  getReport(): BudgetReport {
    const today = localDate();
    const agents: AgentBudgetStatus[] = [];
    let total = 0;
    for (const [name, entry] of this.daily.entries()) {
      if (entry.date !== today) continue; // eski gunler raporda yok
      const role = this.roles.get(name) ?? "specialist";
      const s = this.getDailyStatus(name, role);
      agents.push(s);
      total += s.usd;
    }
    agents.sort((a, b) => b.usd - a.usd);
    const topSpenders = agents.slice(0, 5);
    // Rolling 1h: tum ajanlar.
    let hourlyTotal = 0;
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const arr of this.hourly.values()) {
      for (const e of arr) if (e.ts >= cutoff) hourlyTotal += e.usd;
    }
    return {
      config: { ...this.config },
      agents,
      topSpenders,
      hourlyBurnUsd: hourlyTotal,
      hourlyAlarm: hourlyTotal >= this.config.hourlyBurnAlarmUsd,
      todayTotalUsd: total,
    };
  }

  /** Gunluk reset — interval ile cagrilir (her 10 dk kontrol). */
  resetDaily(): void {
    const today = localDate();
    let changed = false;
    for (const [name, entry] of this.daily.entries()) {
      if (entry.date !== today) {
        this.daily.delete(name);
        changed = true;
      }
    }
    if (changed) {
      this.notifiedFallback.clear();
      this.scheduleSave();
    }
  }

  /** Cap config'ini guncelle + persist. */
  updateConfig(patch: Partial<BudgetConfig>): BudgetConfig {
    this.config = { ...this.config, ...patch };
    // Cap degistiyse fallback bayraklarini sifirla — yeni cap'te tekrar
    // degerlendirilsin.
    this.notifiedFallback.clear();
    this.scheduleSave();
    return { ...this.config };
  }

  /** Role icin cap USD'sini dondur. */
  capFor(role: BudgetRole): number {
    if (role === "chief") return this.config.perChiefDailyUsd;
    if (role === "mimar") return this.config.perMimarDailyUsd;
    return this.config.perAgentDailyUsd;
  }

  /** Process exit / sigterm icin senkron flush. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveNow();
  }

  /** Config snapshot — UI default'larini cizmek icin. */
  getConfig(): BudgetConfig {
    return { ...this.config };
  }

  // ---- Internals ----

  private getDailyStatus(agentName: string, role: BudgetRole): AgentBudgetStatus {
    const today = localDate();
    const entry = this.daily.get(agentName);
    const usd = entry && entry.date === today ? entry.usd : 0;
    const capUsd = this.capFor(role);
    const pctUsed = capUsd > 0 ? Math.min(usd / capUsd, 2) : 0;
    return {
      agent: agentName,
      usd,
      capUsd,
      pctUsed,
      exceeded: usd >= capUsd,
      atWarning: pctUsed >= this.config.fallbackThresholdPct,
    };
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 30_000);
  }

  private saveNow(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const today = localDate();
      // Sadece bugune ait kayitlari sakla — eski tarihler diskte sismeasin.
      const dailyTotals: Array<[string, DailyEntry]> = [];
      for (const [name, entry] of this.daily.entries()) {
        if (entry.date === today) dailyTotals.push([name, { ...entry }]);
      }
      const payload: PersistShape = {
        config: this.config,
        dailyTotals,
      };
      writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf8");
    } catch {
      /* yoksay — disk hatasi kritik degil, state RAM'de */
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const raw = readFileSync(this.filePath, "utf8").trim();
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistShape>;
      if (parsed.config) {
        this.config = { ...this.config, ...parsed.config };
      }
      const today = localDate();
      if (Array.isArray(parsed.dailyTotals)) {
        for (const [name, entry] of parsed.dailyTotals) {
          if (entry && entry.date === today) {
            this.daily.set(name, { usd: entry.usd, date: entry.date });
          }
        }
      }
    } catch {
      /* corrupt — sifirdan baslar */
    }
  }
}

// Auto-fallback hedef model. Fix 104: 'fast' bir model slug'i degil (404),
// service_tier ile gelecek. Su an "ucuza in" = sonnet-4-6.
export const FALLBACK_CHEAPER_MODEL = "claude-sonnet-4-6";
