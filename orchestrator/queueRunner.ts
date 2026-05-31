// AutonomousManager queue/git/chief baglantisi + queue runner kicker yardimcisi.
//
// wireAutonomousManager() main.ts'te queue tanimlandiktan hemen sonra cagrilir.
// AutonomousManager.attach({...}) callback'leri ile sef'in autonomous turn
// uretmesini saglar. F9 oncesi main.ts'te bir function olarak duruyordu —
// burada izole edildi, deps DI ile beslenir.

import type { CommandQueue, Command } from "./queue.js";
import type { SessionStore, SessionChatEntry } from "./sessionStore.js";
import type { AutonomousManager } from "./autonomousMode.js";
import type { Logger } from "./logger.js";
import type { ArchitectServer } from "./server.js";
import { commitAll as gitCommitAll, changedFiles as gitChangedFiles } from "./git.js";

export interface QueueRunnerDeps {
  queue: CommandQueue;
  chief: SessionStore;
  autonomousManager: AutonomousManager;
  logger: Logger;
  server: ArchitectServer;
  projectRoot: string;
  runCommand: (cmd: Command) => Promise<void>;
  isPausedFor: (sid: string) => boolean;
  pushStatus: () => void;
  syncSessionState: () => void;
}

export interface QueueRunnerApi {
  wireAutonomousManager: () => void;
  // queue.process kisa-yolu — yeni komut enqueue eden caller'lar bunu
  // tetikleyebilir (handler + pause callback hep ayni).
  kick: () => void;
}

export function createQueueRunner(deps: QueueRunnerDeps): QueueRunnerApi {
  const {
    queue,
    chief,
    autonomousManager,
    logger,
    server,
    projectRoot,
    isPausedFor,
    pushStatus,
    syncSessionState,
  } = deps;
  // runCommand'i late-bound refer etmek icin deps uzerinden cagiriyoruz —
  // main.ts'te bootstrap sirasinda dispatchRunCommand yeniden atanmis olabilir.
  const runCommandRef = (): typeof deps.runCommand => deps.runCommand;

  function wireAutonomousManager(): void {
    autonomousManager.attach({
      enqueueAutonomousTurn: (text, jobId) => {
        const primaryId = chief.getPrimaryId() ?? chief.getActiveId();
        queue.enqueue(text, { autonomous: true, sessionId: primaryId, autonomousJobId: jobId });
        void queue.process(runCommandRef(), (sid) => isPausedFor(sid));
      },
      gitCommit: (message) => {
        try {
          const r = gitCommitAll(projectRoot, message);
          return { committed: r.committed, hash: r.hash };
        } catch (e) {
          logger.warn("autonomous_git_commit_hata", { hata: (e as Error).message });
          return { committed: false, hash: "" };
        }
      },
      countDirtyFiles: () => {
        try {
          return gitChangedFiles(projectRoot).length;
        } catch {
          return 0;
        }
      },
      appendChatMessage: (text) => {
        const sid = chief.getPrimaryId() ?? chief.getActiveId();
        chief.pushChatFor(sid, { role: "sef", text, ts: Date.now() } as SessionChatEntry);
        chief.saveChatFor(sid);
        if (sid === chief.getActiveId()) syncSessionState();
      },
      pushStatus: () => pushStatus(),
    });
    void server; // server'i tutmuyoruz ama ileride direkt event yayini icin saklanabilir.
  }

  function kick(): void {
    void queue.process(runCommandRef(), (sid) => isPausedFor(sid));
  }

  return { wireAutonomousManager, kick };
}
