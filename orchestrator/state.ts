// main.ts'ten cikarilmis mutable runtime state. Cesitli modules (chief/
// runChiefAttempt.ts, chief/runCommand.ts, chief/autoCompact.ts,
// statusBuilder.ts) paylasilan state'e dependency injection ile erisir.
//
// Tasarim secimi: state'i dosya-modulu olarak diger modullerin `import`
// etmesi yerine, main.ts'te tek instance olusturulur ve factory dep
// olarak gecirilir. Bu yaklasim:
//   - Test edilebilirlik: her testte taze state.
//   - Coklu orchestrator (advisor / global / sef) ayni process'te
//     calistirilirsa cakistirma yok.
//   - Tip guvenligi: getter/setter explicit.
//
// CostTracker — process boyu birikmis $ + son 1 saatlik ring buffer.
// PauseTracker — pause/stop/active query takibi (per-session).
// RunnerState — kucuk skaler bayraklar (autoDevam, reflectOnNext vs).

import type { query } from "@anthropic-ai/claude-agent-sdk";
import type { Effort } from "./effort.js";

// ---------------------------------------------------------------------------
// CostTracker — sessionUsd + son 1 saatlik USD ring buffer.
// ---------------------------------------------------------------------------

interface UsdEntry {
  ts: number;
  usd: number;
}

export class CostTracker {
  private _sessionUsd = 0;
  private history: UsdEntry[] = [];

  get sessionUsd(): number {
    return this._sessionUsd;
  }

  addSessionUsd(usd: number): void {
    if (usd > 0) this._sessionUsd += usd;
  }

  recordUsd(usd: number): void {
    if (usd <= 0) return;
    const now = Date.now();
    this.history.push({ ts: now, usd });
    // 1h+ eski kayitlari ayikla (her insertion'da O(n) ama liste kucuk kalir).
    const cutoff = now - 60 * 60 * 1000;
    while (this.history.length && this.history[0].ts < cutoff) {
      this.history.shift();
    }
  }

  getHourlyUsd(): number {
    const cutoff = Date.now() - 60 * 60 * 1000;
    let toplam = 0;
    for (const e of this.history) if (e.ts >= cutoff) toplam += e.usd;
    return toplam;
  }
}

// ---------------------------------------------------------------------------
// PauseTracker — per-session pause/stop + activeQuery map. Eski tek-session
// `paused` + `activeQuery` global'leri sid-bazli paralel calismaya gore
// genisletildi (P1.33).
// ---------------------------------------------------------------------------

type ActiveQuery = ReturnType<typeof query>;

export class PauseTracker {
  private pausedSids = new Set<string>();
  // F7: durdur = "mevcut turu kes ama kuyrugu paused yapma". pausedSids'den
  // ayri tutulur — durdur sinyali sadece runCommand finalize asamasinda okunur.
  private stoppedSids = new Set<string>();
  // P1.33: per-session aktif query Map.
  private activeQueries = new Map<string, ActiveQuery>();
  // Fix STOP-2: per-session AbortController. query() options.abortController ile
  // bind edilir; interrupt() graceful kesmezse hard-abort garanti. durdur/duraklat
  // interrupt() sonrasi bunu abort() eder. Cift-abort guard signal.aborted ile.
  private activeAborts = new Map<string, AbortController>();
  // Pause sirasinda gecen sure cache-cold sayilmasin diye duraklat/devam
  // arasini biriktirip cache esigi hesabindan duseriz.
  pauseStartedAt = 0;
  pausedDurationMs = 0;

  isPausedFor(sid: string): boolean {
    return this.pausedSids.has(sid);
  }

  addPaused(sid: string): void {
    this.pausedSids.add(sid);
  }

  removePaused(sid: string): boolean {
    return this.pausedSids.delete(sid);
  }

  clearPaused(): void {
    this.pausedSids.clear();
  }

  pausedSnapshot(): string[] {
    return [...this.pausedSids];
  }

  hasPausedSid(sid: string): boolean {
    return this.pausedSids.has(sid);
  }

  isStoppedFor(sid: string): boolean {
    return this.stoppedSids.has(sid);
  }

  addStopped(sid: string): void {
    this.stoppedSids.add(sid);
  }

  removeStopped(sid: string): boolean {
    return this.stoppedSids.delete(sid);
  }

  setActiveQuery(sid: string, q: ActiveQuery, abort?: AbortController): void {
    this.activeQueries.set(sid, q);
    if (abort) this.activeAborts.set(sid, abort);
  }

  getActiveQuery(sid: string): ActiveQuery | undefined {
    return this.activeQueries.get(sid);
  }

  // Fix STOP-2: targeted hard-abort. interrupt() graceful kesmezse cagrilir.
  // Cift-abort guard: signal zaten aborted ise no-op.
  abortFor(sid: string): boolean {
    const ctrl = this.activeAborts.get(sid);
    if (!ctrl) return false;
    if (ctrl.signal.aborted) return false;
    try {
      ctrl.abort();
    } catch {
      /* yoksay */
    }
    return true;
  }

  deleteActiveQuery(sid: string): boolean {
    this.activeAborts.delete(sid);
    return this.activeQueries.delete(sid);
  }

  anyActiveQuery(): boolean {
    return this.activeQueries.size > 0;
  }

  runningSessionIds(): string[] {
    return [...this.activeQueries.keys()];
  }

  // Graceful shutdown'da tum aktif query'leri kibarca durdur.
  interruptAll(): void {
    for (const q of this.activeQueries.values()) {
      try {
        q.interrupt?.().catch(() => {});
      } catch {
        /* yoksay */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// RunnerState — kucuk skaler bayraklar. Module-level let'leri sef SDK
// turunun degisik fazlarinda guncellemek icin tek "tasiyici".
// ---------------------------------------------------------------------------

export class RunnerState {
  // chiefModel / chiefEffort - default model + effort (proje-level).
  // Per-session override SessionStore'da; bu degerler yeni session'larin
  // default'u + setChiefPrefs persist'i icin.
  chiefModel: string;
  chiefEffort: Effort;
  // Fast mode (priority service tier) — proje-level default. Per-session
  // override SessionStore.fast'ta. UI toggle bunu set eder + prefs'e persist.
  chiefFast: boolean;

  // /clear sonrasi ilk turde memSys'i atla — taze cache prefix kurmaya yardim.
  skipMemSysOnNextTurn = false;

  // "Yarim plan" otomatik DEVAM ET enjeksiyonu icin sayac.
  autoDevamCount = 0;

  // Reflection sibling chain — Haiku ile son turun arka plan kritigi.
  pendingReflection: Promise<string> | null = null;
  lastReflection: string | null = null;
  // Default kapali — sadece efort=high, manuel /reflect veya hata durumunda.
  reflectOnNextTurn = false;

  // Plan modu — UI toggle, runChiefAttempt cache prefix'inde mutable.
  planMode: boolean;

  // Prompt cache TTL takibi.
  lastChiefTurnTs = 0;

  // Auto-compact paralel tetiklemesini engelle.
  autoCompactRunning = false;

  // Danismanla etkilesim sonrasi compact tetikleme bayragi (su anda kapali).
  advisorInteractionPending = false;

  constructor(opts: { chiefModel: string; chiefEffort: Effort; chiefFast?: boolean; planMode: boolean }) {
    this.chiefModel = opts.chiefModel;
    this.chiefEffort = opts.chiefEffort;
    this.chiefFast = opts.chiefFast ?? false;
    this.planMode = opts.planMode;
  }
}
