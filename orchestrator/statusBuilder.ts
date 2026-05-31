// getStatus() — UI'a WebSocket uzerinden push edilen tum durum snapshot'i.
// Aktif session, queue listesi, sef model/effort, chat, context %, paused
// sids, hourly $, butce, sessions, autonomous jobs vs. tek payload halinde.
//
// F9: main.ts ek parcalama — factory pattern.

import type { CommandQueue } from "./queue.js";
import type { SessionStore, SessionChatEntry } from "./sessionStore.js";
import type { AgentRegistry } from "./registry.js";
import type { BudgetManager } from "./budgetManager.js";
import type { ErrorTracker } from "./errorTracker.js";
import type { AutonomousManager } from "./autonomousMode.js";
import type { CostTracker, PauseTracker } from "./state.js";
import type { Effort } from "./effort.js";

export interface StatusBuilderDeps {
  isGlobal: boolean;
  registry: AgentRegistry;
  queue: CommandQueue;
  chief: SessionStore;
  budgetManager: BudgetManager;
  errorTracker: ErrorTracker;
  autonomousManager: AutonomousManager;
  pauseTracker: PauseTracker;
  costTracker: CostTracker;
  appDataDir: () => string;
  // Per-session model/effort cozumlemesi — runChiefAttempt ile ayni helpers.
  sessionModelFor: (sid: string) => string;
  sessionEffortFor: (sid: string) => Effort;
  sessionFastFor: (sid: string) => boolean;
  // Aktif session mirror'lari — module-level chatLog / lastContext.
  getChatLog: () => SessionChatEntry[];
  getLastContext: () => number;
  // Proxy stats — anthropicProxy modulu uzerinden.
  getProxyStats: () => unknown;
  // Auto-rollback son olayi — UI banner icin.
  readLastRollback: (appDataDir: string) => unknown;
}

export function createStatusBuilder(deps: StatusBuilderDeps): () => Record<string, unknown> {
  const {
    isGlobal,
    registry,
    queue,
    chief,
    budgetManager,
    errorTracker,
    autonomousManager,
    pauseTracker,
    costTracker,
    appDataDir,
    sessionModelFor,
    sessionEffortFor,
    sessionFastFor,
    getChatLog,
    getLastContext,
    getProxyStats,
    readLastRollback,
  } = deps;

  return function getStatus() {
    return {
      agents: registry.list().map((a) => ({
        name: a.name,
        role: a.role,
        model: a.model,
        effort: a.effort,
        skills: a.skills,
      })),
      queue: queue.list().map((c) => ({ id: c.id, text: c.text, status: c.status, sessionId: c.sessionId })),
      // M6 (rebuild guard): aktif tur calisiyor mu? rebuild_ui tool baska
      // orchestrator'lari pinglerken bu alandan busy okur.
      // F1.3b: bgTasks + health.active kontrolu kaldirildi — specialist
      // subprocess yok, Agent tool calismasi anyActiveQuery icine giriyor.
      busy:
        pauseTracker.anyActiveQuery() ||
        queue.list().some((c) => c.status === "isleniyor"),
      // Per-session model: UI picker aktif sessionun modelini gostersin. Yeni
      // session olusturulduginda state.model=null → sessionModelFor() default'a
      // (chiefModel) duser. Session-switch sonrasinda picker o sessionin
      // modelini gosterir → mental model "her sekmenin kendi modeli".
      chief: {
        model: sessionModelFor(chief.getActiveId()),
        effort: sessionEffortFor(chief.getActiveId()),
        fast: sessionFastFor(chief.getActiveId()),
      },
      chat: getChatLog(),
      context: getLastContext(),
      // P1.33: per-session running indicator. UI runningSessions.includes(active)
      // ile sadece o sekmede Thinking gosterir; baska session'da query calisirken
      // aktif sekme bos kalir.
      runningSessions: pauseTracker.runningSessionIds(),
      // Fix 44: per-session paused. UI aktif sessionin pause durumunu gosterir.
      paused: pauseTracker.isPausedFor(chief.getActiveId()),
      pausedSids: pauseTracker.pausedSnapshot(),
      // Cache hit/miss telemetrisi — 1h TTL proxy bu sayaclari biriktirir.
      // UI istedigi an Reports/Usage ekraninda "%hit, tasarruf $" gosterebilir.
      cacheStats: getProxyStats(),
      // Son auto-rollback olayi — UI turuncu banner ile gosterir; banner
      // kapatilana kadar persist eder (clearAutoRollback komutu temizler).
      autoRollback: readLastRollback(appDataDir()),
      // Hata fingerprint ozeti — son 20 fingerprint + tool ardisik hata.
      errorTracker: errorTracker.summary(),
      // M6: dolar telemetrisi — UI header session badge'inde "$X/saat (son 1h)"
      // ve sessionUsd gosterilir.
      cost: {
        sessionUsd: costTracker.sessionUsd,
        hourlyUsd: costTracker.getHourlyUsd(),
      },
      // F4: butce raporu — UI BudgetCard bunu cizer. Per-agent gunluk USD/cap +
      // top-5 spender + saatlik burn-rate alarm flag'i. Cap edit set_budget_cap
      // MCP tool veya WS uzerinden (su an MCP tool tarafi destekli).
      // Gunluk harcama cap sistemi kaldirildi (kullanici talebi) — UI butce
      // chip/card render etmesin. Maliyet telemetrisi (cost.sessionUsd/hourlyUsd)
      // korunuyor (ust barda Session $ / $/saat). budgets:null -> chip gizli.
      budgets: null,
      // B: Multi-session listesi. activeSessionId UI'da aktif rozet icin,
      // sessions[] sag panel listesinde primary'i ust + secondary'ler
      // son sohbet sirali. isGlobal: secondary'lerde silme butonu aktif.
      sessions: chief.list(),
      activeSessionId: chief.getActiveId(),
      // P1.28: backwards-compat — runningSessions[0] varsa onu, yoksa null.
      // Eski UI clientleri activeQuerySessionId okuyor; runningSessions yeni alan.
      activeQuerySessionId: pauseTracker.runningSessionIds()[0] ?? null,
      // P1.29: aktif session'in son /clear timestamp'i. UI bunu izler;
      // arttiginda local chat tamamen sifirlanir + backend snapshot'i yuklenir.
      // Aksi halde /clear sonrasi eski mesajlar UI'da kaliyor (reconcile sadece
      // "yeni mesaj ekle" yapiyor, "eski mesajlari sil" yapmiyor).
      lastClearTs: chief.getLastClearReason().ts,
      // Fix 64: lastClearReason UI'a iletir. UI sadece "user_clear" / "compact"
      // reason'larinda chat'i sifirlar. "user_pause_interrupt" /
      // "transient_*" reason'larinda chat KORUNUR — pause sonrasi kullanici
      // mesajlari kaybolmamali.
      lastClearReason: chief.getLastClearReason().reason,
      sessionsContext: { isGlobal },
      // Fix 99: specialist chat snapshot. UI agentChat $derived feed-derived'di;
      // window close sonra feed=[] olunca uzman sohbetleri bombostu. Status
      // snapshot disk-persisted chat'i tasir → UI restore eder.
      specialistChats: registry.allChats(),
      // F3: otonom is listesi — UI JobMonitor sag panel gosterimi icin.
      autonomousJobs: autonomousManager.listJobs(),
    };
  };
}
