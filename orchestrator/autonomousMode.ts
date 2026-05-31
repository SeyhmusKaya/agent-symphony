// orchestrator/autonomousMode.ts — F3 (Otonom 3-Gun Modu).
//
// Master plan section "F3: Otonom 3-Gun Modu" karsiligi. Kullanici cok-gunluk
// bir gorev tanimlar ("Volpora checkout sayfasini bastan yaz, 3 gun yok"),
// AutonomousManager bunu izler:
//
//   - startJob() → kalici Job kaydi yaz + ilk otonom turu queue'ya enjekte et.
//   - Her otonom tur bittiginde main.ts onTurnDone callback'ini cagirir →
//     onTurnCheckpoint(jobId) bumps istatistikleri, gerekirse git_commit.
//   - 3 ardisik failure → job "failed" + notification.
//   - maxDays * 24h asilirsa force-cancel + notification.
//   - Kullanici pause/resume/cancel ile dis kontrol verir.
//
// MEVCUT ALTYAPI TEKRAR KULLANILIYOR:
//   - queue.enqueue(text, { autonomous:true }): otonom tur enjekte.
//   - registry.appendChat / chief.pushChatFor: final report mesaji UI'a.
//   - git_commit (tools/gitTools.ts) ya da git.ts commitAll: 30 dk / 5+ dosya.
//   - errorTracker auto-rollback: catastrophic failure → ayri sistem.
//
// SLEEP LOOP YOK: onTurnCheckpoint event-driven (main.ts cagirir). Tek timer
// maxDays cap kontrolu icin — yarim saatte bir tetiklenir.
//
// DISK LAYOUT: tek dosya per orchestrator instance:
//   {appDataDir}/autonomous-jobs.json
// Mimar (__global__) ve proje sefi orchestratorlari KENDI dosyalarinda tutar.
// Cross-process koordinasyon yok — her sef kendi otonom isini yonetir.
//
// UI ENTEGRASYONU: status payload "autonomousJobs" alani; ws "durum" event'i
// ile UI'a aktarilir. Ayrica notify event'leri Notifier uzerinden gider.
// Backend Tauri command yerine WS event tercih edildi (orchestrator ↔ UI
// halen WS, ek IPC katmani yok).

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Notifier } from "./notifications.js";

export type EmitFn = (kind: string, payload: Record<string, unknown>) => void;

// Maks gun limiti — env ile override edilebilir. Hard cap = 14.
const MAX_AUTO_DAYS = (() => {
  const raw = Number(process.env.MAX_AUTO_DAYS);
  if (!Number.isFinite(raw) || raw <= 0) return 7;
  return Math.min(Math.floor(raw), 14);
})();

// Bir saatte 1 kez progress event'i tetikleyen sayac — main.ts'in
// onTurnCheckpoint cagirisini fazla sik UI'a yansitmamak icin.
const PROGRESS_BROADCAST_INTERVAL_MS = 60 * 60 * 1000;
// Auto-commit kosullari.
const COMMIT_INTERVAL_MS = 30 * 60 * 1000; // 30 dakika
const COMMIT_FILE_THRESHOLD = 5;
// Ardisik basarisizlik snapshot'i — bu rakam asilinca job failed.
const MAX_CONSECUTIVE_FAILURES = 3;
// maxDays cap watchdog tetik araligi — yarim saat (sleep loop degil; setInterval).
const CAP_WATCHDOG_INTERVAL_MS = 30 * 60 * 1000;

export type AutonomousJobStatus =
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface AutonomousJob {
  id: string;
  sefProjectId: string;
  task: string;
  maxDays: number;
  startedAt: number;
  finishedAt?: number | null;
  status: AutonomousJobStatus;
  // Son onTurnCheckpoint cagri ts — UI son aktivite gosteriminde kullanir.
  lastCheckpoint: number;
  // Son commit ts (auto-commit takvimi icin).
  lastCommitTs: number;
  commitsMade: number;
  filesChanged: number; // Son commit'ten sonra biriken (commit sonrasi sifirlanir).
  filesChangedTotal: number; // Job omru boyunca toplam degisen dosya sayisi.
  costUsdTotal: number;
  notifyOnComplete: boolean;
  // Ardisik fail sayaci — basarili tur sayaci sifirlar.
  consecutiveFailures: number;
  // Toplam turlar.
  turnsTotal: number;
  // Son progress broadcast ts'i — saatlik UI guncellemesi icin.
  lastProgressBroadcastTs: number;
  // Hata aciklamasi (failed ise).
  failReason?: string | null;
}

export interface StartJobOpts {
  task: string;
  maxDays: number;
  notifyOnComplete?: boolean;
}

// Main.ts'den gelen baglanti noktalari. AutonomousManager hicbir global
// degiskene dokunmaz; constructor ile callback aldigi nesneleri kullanir.
export interface AutonomousAttachOpts {
  // Otonom tur enjekte et. Job iceriginde mevcut text + autonomous:true.
  enqueueAutonomousTurn: (text: string, jobId: string) => void;
  // git_commit calistir; commitAll wrapper'i. Donus: { committed, hash }.
  gitCommit: (message: string) => { committed: boolean; hash: string };
  // Calisma agacindaki son commit'ten beri degisen dosya sayisi.
  countDirtyFiles: () => number;
  // Sef sohbetine "final report" mesaji ekle (UI gosterir).
  appendChatMessage: (text: string) => void;
  // Status push (sayilarin UI'a anlik gitmesi icin).
  pushStatus: () => void;
}

export interface AutonomousManagerOpts {
  appDataDir: string;
  sefProjectId: string;
  emit: EmitFn;
  notifier: Notifier;
  logger?: { info: (m: string, x?: Record<string, unknown>) => void; warn: (m: string, x?: Record<string, unknown>) => void; error: (m: string, x?: Record<string, unknown>) => void };
}

function jobsFilePath(appDataDir: string, sefProjectId: string): string {
  // Tek dosya per orchestrator — projectId suffix dosyaadinda.
  const safeId = sefProjectId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${appDataDir}/autonomous-jobs-${safeId}.json`;
}

export class AutonomousManager {
  private opts: AutonomousManagerOpts;
  private jobs: Map<string, AutonomousJob> = new Map();
  private attached: AutonomousAttachOpts | null = null;
  private capWatchdog: NodeJS.Timeout | null = null;

  constructor(opts: AutonomousManagerOpts) {
    this.opts = opts;
    this.load();
    // maxDays cap watchdog — periodik kontrol; sleep degil setInterval.
    this.capWatchdog = setInterval(() => this.checkCaps(), CAP_WATCHDOG_INTERVAL_MS);
    if (typeof this.capWatchdog.unref === "function") this.capWatchdog.unref();
  }

  // Main.ts orchestrator hazir oldugunda attach() cagirir. Constructor'da
  // verilemez cunku queue/git/chief gibi bagimliliklar daha sonra kuruluyor.
  attach(a: AutonomousAttachOpts): void {
    this.attached = a;
  }

  // Test/shutdown icin.
  dispose(): void {
    if (this.capWatchdog) {
      clearInterval(this.capWatchdog);
      this.capWatchdog = null;
    }
  }

  // === PUBLIC API ===

  listJobs(): AutonomousJob[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  getJob(jobId: string): AutonomousJob | undefined {
    return this.jobs.get(jobId);
  }

  startJob(input: StartJobOpts): { jobId: string; job: AutonomousJob } {
    if (input.maxDays <= 0) {
      throw new Error("maxDays > 0 olmali");
    }
    if (input.maxDays > MAX_AUTO_DAYS) {
      throw new Error(`maxDays ust limiti ${MAX_AUTO_DAYS} gun. Daha buyuk istek reddedildi.`);
    }
    if (!input.task || !input.task.trim()) {
      throw new Error("task bos olamaz");
    }
    const now = Date.now();
    const job: AutonomousJob = {
      id: randomUUID(),
      sefProjectId: this.opts.sefProjectId,
      task: input.task.trim(),
      maxDays: input.maxDays,
      startedAt: now,
      finishedAt: null,
      status: "running",
      lastCheckpoint: now,
      lastCommitTs: now,
      commitsMade: 0,
      filesChanged: 0,
      filesChangedTotal: 0,
      costUsdTotal: 0,
      notifyOnComplete: input.notifyOnComplete ?? true,
      consecutiveFailures: 0,
      turnsTotal: 0,
      lastProgressBroadcastTs: now,
      failReason: null,
    };
    this.jobs.set(job.id, job);
    this.persist();
    // Ilk otonom turu queue'ya enjekte — sef gorev metnini gorur.
    if (this.attached) {
      const initialPrompt =
        `[OTONOM IS BASLATILDI] Job ID: ${job.id}\n` +
        `Max sure: ${job.maxDays} gun.\n` +
        `Gorev: ${job.task}\n\n` +
        `Kullaniciya soru sorma — bu otonom tur. Planini yap, baslat, ` +
        `iste o sirada git_commit ile her 30 dakikada bir checkpoint at. ` +
        `Tum agirlikli dosyalar degistiginde de commit at. ` +
        `Bitince ozet uret.`;
      this.attached.enqueueAutonomousTurn(initialPrompt, job.id);
    }
    this.opts.logger?.info("autonomous_job_baslatildi", { jobId: job.id, task: job.task, maxDays: job.maxDays });
    void this.opts.notifier.send({
      kind: "autonomous_job_started",
      title: "Otonom is baslatildi",
      body: `Sef "${job.task}" gorevine basladi. ${job.maxDays} gun otonom calisacak.`,
      meta: { jobId: job.id },
    });
    this.attached?.pushStatus();
    return { jobId: job.id, job };
  }

  pauseJob(jobId: string): AutonomousJob {
    const job = this.requireJob(jobId);
    if (job.status !== "running") {
      throw new Error(`Job durumu pause edilebilir degil: ${job.status}`);
    }
    job.status = "paused";
    this.persist();
    void this.opts.notifier.send({
      kind: "autonomous_job_paused",
      title: "Otonom is duraklatildi",
      body: `"${job.task}" duraklatildi.`,
      meta: { jobId: job.id },
    });
    this.attached?.pushStatus();
    return job;
  }

  resumeJob(jobId: string): AutonomousJob {
    const job = this.requireJob(jobId);
    if (job.status !== "paused") {
      throw new Error(`Job durumu resume edilebilir degil: ${job.status}`);
    }
    job.status = "running";
    job.lastCheckpoint = Date.now();
    this.persist();
    if (this.attached) {
      const resumePrompt =
        `[OTONOM IS DEVAM] Job ID: ${jobId}\nGorev: ${job.task}\n` +
        `Duraklattigin yerden devam et. Kalan gun: ${this.remainingHours(job) / 24}.`;
      this.attached.enqueueAutonomousTurn(resumePrompt, jobId);
    }
    this.attached?.pushStatus();
    return job;
  }

  cancelJob(jobId: string): AutonomousJob {
    const job = this.requireJob(jobId);
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return job;
    }
    job.status = "cancelled";
    job.finishedAt = Date.now();
    this.persist();
    void this.opts.notifier.send({
      kind: "autonomous_job_cancelled",
      title: "Otonom is iptal edildi",
      body: `"${job.task}" kullanici tarafindan iptal edildi.`,
      meta: { jobId: job.id },
    });
    this.attached?.pushStatus();
    return job;
  }

  // === EVENT-DRIVEN CALLBACKS (main.ts cagirir) ===

  // Otonom tur basariyla bittikten sonra. Sayilari bump et, gerekirse commit at,
  // saatlik progress event'i yay.
  async onTurnCheckpoint(jobId: string, costUsdDelta = 0): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status !== "running") return;
    const now = Date.now();
    job.lastCheckpoint = now;
    job.turnsTotal += 1;
    job.consecutiveFailures = 0;
    job.costUsdTotal += Math.max(0, costUsdDelta);

    // Calisma agacindaki kirli dosya sayisini guncelle (heuristic).
    if (this.attached) {
      try {
        const dirty = this.attached.countDirtyFiles();
        // Bu commit'ten sonra biriken — ozet UI icin.
        job.filesChanged = dirty;
      } catch (e) {
        this.opts.logger?.warn("autonomous_dirty_count_hata", { hata: (e as Error).message });
      }
    }

    // Saatlik progress event'i — UI'da bar canlandirir, OS bildirimi YOK.
    if (now - job.lastProgressBroadcastTs >= PROGRESS_BROADCAST_INTERVAL_MS) {
      job.lastProgressBroadcastTs = now;
      this.opts.emit("autonomous_progress", {
        jobId: job.id,
        elapsedHours: this.elapsedHours(job),
        remainingHours: this.remainingHours(job),
        commitsMade: job.commitsMade,
        filesChanged: job.filesChanged,
        filesChangedTotal: job.filesChangedTotal,
        costUsdTotal: job.costUsdTotal,
        turnsTotal: job.turnsTotal,
      });
    }

    // Otomatik commit kosullari: 30 dk gectiyse VEYA 5+ dosya birikti.
    const elapsedSinceCommit = now - job.lastCommitTs;
    if (
      this.attached &&
      (elapsedSinceCommit >= COMMIT_INTERVAL_MS || job.filesChanged >= COMMIT_FILE_THRESHOLD)
    ) {
      await this.runAutoCheckpoint(job);
    }

    this.persist();
    this.attached?.pushStatus();
  }

  // Tur basarisizlikla bittiginde. consecutiveFailures ++; 3 olunca failed.
  async onTurnFailure(jobId: string, error: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status !== "running") return;
    job.consecutiveFailures += 1;
    job.lastCheckpoint = Date.now();
    this.opts.logger?.warn("autonomous_turn_failure", {
      jobId,
      consecutive: job.consecutiveFailures,
      error: error.slice(0, 200),
    });
    if (job.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      job.status = "failed";
      job.finishedAt = Date.now();
      job.failReason = `${MAX_CONSECUTIVE_FAILURES} ardisik tur basarisiz oldu. Son hata: ${error.slice(0, 200)}`;
      await this.opts.notifier.send({
        kind: "autonomous_job_failed",
        title: "Otonom is basarisiz",
        body: `"${job.task}" 3 ardisik hata sonrasi durduruldu. Sebep: ${error.slice(0, 200)}`,
        meta: { jobId: job.id },
      });
      this.opts.logger?.error("autonomous_job_failed", { jobId, reason: job.failReason });
    }
    this.persist();
    this.attached?.pushStatus();
  }

  // Sef "is bitti" sinyali verdiginde — sef bizzat finalize_autonomous_job
  // cagirabilir veya plan tamamen yarim olmadiginda runCommand sonunda
  // otomatik tetiklenebilir. Su anda agent tool kismi ile entegre.
  async completeJob(jobId: string): Promise<AutonomousJob> {
    const job = this.requireJob(jobId);
    if (job.status === "completed") return job;
    job.status = "completed";
    job.finishedAt = Date.now();
    // Son commit (varsa) — sef commit etmeden bitirmis olabilir.
    if (this.attached) {
      const dirty = this.attached.countDirtyFiles();
      if (dirty > 0) {
        await this.runAutoCheckpoint(job, "is bitti - final commit");
      }
    }
    this.persist();
    if (job.notifyOnComplete) {
      const elapsed = this.elapsedHours(job).toFixed(1);
      const usd = job.costUsdTotal.toFixed(2);
      await this.opts.notifier.send({
        kind: "autonomous_job_completed",
        title: "Otonom is bitti",
        body: `"${job.task}" tamamlandi. ${job.commitsMade} commit, ${job.filesChangedTotal} dosya, ${elapsed} saat, $${usd} harcandi.`,
        meta: { jobId: job.id },
      });
    }
    this.pushFinalReport(job);
    this.attached?.pushStatus();
    return job;
  }

  // === SORGULAMA ===

  getProgress(jobId: string): {
    elapsedHours: number;
    remainingHours: number;
    commitsMade: number;
    filesChanged: number;
    filesChangedTotal: number;
    costUsdTotal: number;
    lastActivityTs: number;
    status: AutonomousJobStatus;
    turnsTotal: number;
  } {
    const job = this.requireJob(jobId);
    return {
      elapsedHours: this.elapsedHours(job),
      remainingHours: this.remainingHours(job),
      commitsMade: job.commitsMade,
      filesChanged: job.filesChanged,
      filesChangedTotal: job.filesChangedTotal,
      costUsdTotal: job.costUsdTotal,
      lastActivityTs: job.lastCheckpoint,
      status: job.status,
      turnsTotal: job.turnsTotal,
    };
  }

  // Final report — summary. Also returns plain text not sent to the notifier.
  finalReport(jobId: string): string {
    const job = this.requireJob(jobId);
    const elapsed = this.elapsedHours(job).toFixed(1);
    const usd = job.costUsdTotal.toFixed(2);
    return (
      `Otonom is raporu — ${job.task}\n` +
      `Durum: ${job.status}\n` +
      `Sure: ${elapsed} saat (max ${job.maxDays} gun).\n` +
      `Commit sayisi: ${job.commitsMade}\n` +
      `Toplam degisen dosya: ${job.filesChangedTotal}\n` +
      `Tamamlanan tur: ${job.turnsTotal}\n` +
      `Maliyet: $${usd}`
    );
  }

  // === INTERNALS ===

  private async runAutoCheckpoint(job: AutonomousJob, label?: string): Promise<void> {
    if (!this.attached) return;
    const taskLabel = job.task.slice(0, 50);
    const reason = label ?? "auto-checkpoint";
    const msg = `chore: ${reason} - ${taskLabel} (job ${job.id.slice(0, 8)})`;
    try {
      const result = this.attached.gitCommit(msg);
      if (result.committed) {
        job.commitsMade += 1;
        // Bu commit'ten once birikmis dosya sayisini total'a ekle.
        job.filesChangedTotal += Math.max(0, job.filesChanged);
        job.filesChanged = 0;
        job.lastCommitTs = Date.now();
        this.opts.logger?.info("autonomous_auto_commit", {
          jobId: job.id,
          hash: result.hash,
          commitsMade: job.commitsMade,
        });
        this.opts.emit("autonomous_checkpoint", {
          jobId: job.id,
          hash: result.hash,
          commitsMade: job.commitsMade,
          filesChangedTotal: job.filesChangedTotal,
        });
      }
    } catch (e) {
      this.opts.logger?.warn("autonomous_auto_commit_hata", {
        jobId: job.id,
        hata: (e as Error).message,
      });
    }
  }

  private pushFinalReport(job: AutonomousJob): void {
    if (!this.attached) return;
    try {
      const elapsed = this.elapsedHours(job).toFixed(1);
      const usd = job.costUsdTotal.toFixed(2);
      const report =
        `Otonom is bitti: ${job.task}\n` +
        `${job.commitsMade} commit, ${job.filesChangedTotal} dosya, ${elapsed} saat is, $${usd} harcandi.`;
      this.attached.appendChatMessage(report);
    } catch (e) {
      this.opts.logger?.warn("autonomous_final_report_hata", { hata: (e as Error).message });
    }
  }

  private requireJob(jobId: string): AutonomousJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job bulunamadi: ${jobId}`);
    return job;
  }

  private elapsedHours(job: AutonomousJob): number {
    const end = job.finishedAt ?? Date.now();
    return (end - job.startedAt) / (3600 * 1000);
  }

  private remainingHours(job: AutonomousJob): number {
    const cap = job.maxDays * 24;
    return Math.max(0, cap - this.elapsedHours(job));
  }

  // setInterval ile periodik cagrilir — maxDays asilmis running job varsa
  // force-cancel.
  private checkCaps(): void {
    let mutated = false;
    for (const job of this.jobs.values()) {
      if (job.status !== "running" && job.status !== "paused") continue;
      const elapsedHours = this.elapsedHours(job);
      if (elapsedHours >= job.maxDays * 24) {
        job.status = "cancelled";
        job.finishedAt = Date.now();
        job.failReason = `maxDays cap (${job.maxDays} gun) asildi`;
        mutated = true;
        this.opts.logger?.warn("autonomous_max_days_cap_asildi", {
          jobId: job.id,
          maxDays: job.maxDays,
          elapsedHours,
        });
        void this.opts.notifier.send({
          kind: "autonomous_job_cancelled",
          title: "Otonom is sure asti",
          body: `"${job.task}" ${job.maxDays} gun maxDays sinirina ulasti, durduruldu.`,
          meta: { jobId: job.id },
        });
      }
    }
    if (mutated) {
      this.persist();
      this.attached?.pushStatus();
    }
  }

  // === PERSISTENCE ===

  private load(): void {
    const path = jobsFilePath(this.opts.appDataDir, this.opts.sefProjectId);
    if (!existsSync(path)) return;
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (!raw) return;
      const arr = JSON.parse(raw) as AutonomousJob[];
      for (const j of arr) {
        // Restart sonrasi running -> paused — kullanici manuel resume etmedikce
        // otomatik turla baslamasin (sef sessionId belki bambaska bir contextte).
        if (j.status === "running") {
          j.status = "paused";
        }
        this.jobs.set(j.id, j);
      }
    } catch (e) {
      this.opts.logger?.warn("autonomous_load_hata", { hata: (e as Error).message });
    }
  }

  private persist(): void {
    const path = jobsFilePath(this.opts.appDataDir, this.opts.sefProjectId);
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const arr = [...this.jobs.values()];
      writeFileSync(path, JSON.stringify(arr, null, 2), "utf8");
    } catch (e) {
      this.opts.logger?.warn("autonomous_persist_hata", { hata: (e as Error).message });
    }
  }
}

export { MAX_AUTO_DAYS };
