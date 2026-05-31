// onCommand WS handler — yeni kullanici komutunu kuyruga al, routeToIdle
// secimine gore session sec, user msg'i chat'e push, kuyrugu tetikle.
// F9 ek parcalama.

import type { SessionStore, SessionChatEntry } from "./sessionStore.js";
import type { CommandQueue, Command } from "./queue.js";
import type { Logger } from "./logger.js";
import type { ArchitectServer, Attachment } from "./server.js";
import type { PauseTracker, RunnerState } from "./state.js";

export interface CommandHandlerDeps {
  chief: SessionStore;
  queue: CommandQueue;
  logger: Logger;
  pauseTracker: PauseTracker;
  state: RunnerState;
  attachMap: Map<string, Attachment[]>;
  emit: (type: string, payload: Record<string, unknown>) => void;
  pushStatus: () => void;
  server: ArchitectServer;
  dispatchRunCommand: (cmd: Command) => Promise<void>;
}

export function createCommandHandler(deps: CommandHandlerDeps) {
  const {
    chief,
    queue,
    logger,
    pauseTracker,
    state,
    attachMap,
    emit,
    pushStatus,
    dispatchRunCommand,
  } = deps;
  const isPausedFor = (sid: string): boolean => pauseTracker.isPausedFor(sid);

  return function onCommand(
    text: string,
    ekler?: Attachment[],
    opts?: { agentCall?: boolean; fromAgent?: string; routeToIdle?: boolean; sessionId?: string },
  ): { commandId: string; sessionId: string } {
    // P1.33: smart routing — cross-agent caller (talk_to_chief) routeToIdle
    // bayragiyla gelir. Aktif session'a degil, BOS session'a yonlendir:
    //   1) primary bos ise -> primary
    //   2) yoksa idle secondary -> secondary
    //   3) hicbir idle yok ise yeni secondary olustur
    // Boylece iki caller ayni anda mimar'a sorarsa farkli session'lara dagilir,
    // kuyrukta beklemeden paralel calisirlar. UI aktif sekme degismez.
    // Fix 120: "tek session iki yerde calisiyor" bug'inin kok cozumu.
    // Eski davranis: targetSid daima mutable getActiveId()'den turetiliyordu.
    // Bir tur DONE gorunup arkada hala kosarken (CORE A) yeni mesaj GELDIGINDE
    // active id degismis olabilir → mesaj farkli/__noid__ bucket'a duser ve
    // ayni mantiksal session icin IKINCI runner spawn olur. Cozum: UI komutu
    // gonderildigi an aktif olan session id'yi DAMGALAR (opts.sessionId). Bu
    // immutable id gecerli bir session'a isaret ediyorsa onu kullan; yoksa
    // (eski UI / cross-agent cagri) eski getActiveId() fallback'i korunur.
    let targetSid = chief.getActiveId();
    if (opts?.sessionId && chief.list().some((s) => s.id === opts.sessionId)) {
      targetSid = opts.sessionId;
    }
    if (opts?.routeToIdle) {
      const running = new Set(pauseTracker.runningSessionIds());
      // Queue'da bekleyen komutlarin sessionId'si — onlar da "busy" sayilir
      // (siraya alinmasin).
      for (const c of queue.list()) {
        if (c.status === "bekliyor" || c.status === "isleniyor") {
          if (c.sessionId) running.add(c.sessionId);
        }
      }
      const all = chief.list();
      const primary = all.find((s) => s.role === "primary");
      const idleSecondary = all.find((s) => s.role === "secondary" && !running.has(s.id));
      if (primary && !running.has(primary.id)) {
        targetSid = primary.id;
      } else if (idleSecondary) {
        targetSid = idleSecondary.id;
      } else {
        // Tum sessionlar mesgul — yeni secondary olustur.
        // Cap: 10 secondary uzerine cikma; o noktada en az pending'e queue.
        const secondaries = all.filter((s) => s.role === "secondary");
        if (secondaries.length < 10) {
          const meta = chief.create(`auto-${opts.fromAgent || "ajan"}-${Date.now() % 100000}`);
          targetSid = meta.id;
          logger.info("routeToIdle_create_session", {
            sid: meta.id,
            fromAgent: opts.fromAgent,
            secondaries: secondaries.length,
          });
        } else {
          // Cap: en az busy session'a queue.
          targetSid = primary?.id ?? all[0]?.id ?? targetSid;
        }
      }
      logger.info("routeToIdle_picked", { targetSid, fromAgent: opts.fromAgent });
    }
    const cmd = queue.enqueue(text, {
      agentCall: opts?.agentCall,
      fromAgent: opts?.fromAgent,
      sessionId: targetSid,
    });
    if (ekler && ekler.length) attachMap.set(cmd.id, ekler);
    // Fix: resimleri ENQUEUE aninda persist et. Eskiden images yalniz
    // attachMap'te (in-memory) tutuluyor, chat.json'a runCommand'da
    // (entry.images = userImages) SONRA yaziliyordu. Mesaj queued kalir ya da
    // enqueue->runCommand arasinda rebuild/restart olursa attachMap kaybolur →
    // chat.json'daki user mesaji image'siz → reload'da resimler gozukmez.
    // Cozum: enqueue'da diske yaz; runCommand re-set'i idempotent (ayni veri).
    const userImages = (ekler ?? [])
      .filter((e) => e.tur === "resim")
      .map((r) => `data:${r.mediaType ?? "image/png"};base64,${r.veri}`);
    // Fix 64b: user msg HEMEN chat'e push — backend snapshot session-switch
    // sirasinda da bu mesaji icersin (UI overwrite'da kaybolmasin).
    // queued: true bayragi UI'da SIRADA rozeti gosterir. runCommand isleme
    // alirken queued false yapilir (chief.pushChatFor zaten yapiyor — duplicate
    // engellemek icin cmd.id ile match).
    chief.pushChatFor(targetSid, {
      role: cmd.agentCall ? "ajan_komut" : "kullanici",
      text: cmd.text,
      ts: Date.now(),
      images: userImages.length ? userImages : undefined,
      fromAgent: cmd.fromAgent,
      commandId: cmd.id,
      queued: true,
    } as SessionChatEntry & { commandId?: string; queued?: boolean });
    // Gercek kullanici turn'u — auto-devam sayacini sifirla.
    // F1.3b: bgTasks.resetChain kaldirildi (BgTaskManager yok).
    state.autoDevamCount = 0;
    // Yeni komut = otomatik devam. Kullanici pause'da unutmus olabilir;
    // mesaj atmasi devam etmek istedigi anlamina gelir.
    // Fix 44: sadece HEDEF sessionin pause flagini temizle, baska sessionlari
    // etkileme.
    if (pauseTracker.removePaused(targetSid)) {
      emit("ajan_durum_degisti", { agent: "sef", durum: "devam" });
    }
    pushStatus();
    void queue.process(dispatchRunCommand, (sid) => isPausedFor(sid));
    return { commandId: cmd.id, sessionId: targetSid };
  };
}
