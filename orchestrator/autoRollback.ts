// Otomatik git rollback + supervisor relaunch.
//
// errorTracker tetiklerse cagrilir. Akis:
//   1. Mevcut HEAD ve last-good.txt'i karsilastir.
//   2. Mevcut HEAD == last-good ise: zaten son saglam surumdesin; daha
//      eski'ye gitme. Kullaniciya kritik bildirim at, manuel mudahale iste.
//   3. Farkliysa: git stash (gecici degisikleri sakla), git checkout
//      last-good, supervisor.js spawn et, kendini sonlandir (1.5s sonra).
//   4. Rollback olayini diske yaz (appDataDir/auto-rollback.json) —
//      sonraki session getStatus()'a ekleyip UI'da banner gosterir.

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { RollbackTrigger } from "./errorTracker.js";

export interface AutoRollbackRecord {
  ts: number;
  oldHash: string;
  newHash: string; // rollback hedefi
  trigger: RollbackTrigger;
  status: "ok" | "skipped_same_hash" | "failed";
  detail?: string;
}

export interface AutoRollbackOpts {
  repoRoot: string;
  appDataDir: string;
  port: number;
  nodeExec: string;
  childArgs: string[];
  emit: (kind: string, payload: Record<string, unknown>) => void;
}

function gitHead(repoRoot: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: repoRoot }).toString().trim();
  } catch {
    return "";
  }
}

function readLastGood(appDataDir: string): string {
  try {
    return readFileSync(join(appDataDir, "last-good.txt"), "utf8").trim();
  } catch {
    return "";
  }
}

function writeRecord(appDataDir: string, rec: AutoRollbackRecord): void {
  const path = join(appDataDir, "auto-rollback.json");
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(rec, null, 2), "utf8");
  } catch {
    /* yoksay */
  }
}

export function readLastRollback(appDataDir: string): AutoRollbackRecord | null {
  const path = join(appDataDir, "auto-rollback.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AutoRollbackRecord;
  } catch {
    return null;
  }
}

export function clearLastRollback(appDataDir: string): void {
  const path = join(appDataDir, "auto-rollback.json");
  if (!existsSync(path)) return;
  try {
    writeFileSync(path, "", "utf8");
  } catch {
    /* yoksay */
  }
}

export function performAutoRollback(
  trigger: RollbackTrigger,
  opts: AutoRollbackOpts,
): void {
  const { repoRoot, appDataDir, port, nodeExec, childArgs, emit } = opts;
  const current = gitHead(repoRoot);
  const lastGood = readLastGood(appDataDir);

  // Hedef ya last-good ya da last-good yoksa HEAD~1.
  let target = lastGood;
  if (!target || target === "none") {
    try {
      target = execSync("git rev-parse HEAD~1", { cwd: repoRoot }).toString().trim();
    } catch {
      target = "";
    }
  }

  // Mevcut HEAD = hedef: rollback yapma, sonsuz loop riski.
  // P1.27: skipped_same_hash bir "no-op" — kullaniciya kirmizi banner
  // gostermek anlamsiz, sadece spam. Sessizce log'la ve don. Sadece
  // gercek "ok" veya "failed" rollback olaylari UI'a bildirilir.
  if (!current || !target || current === target) {
    // Eski record dosyasi banner'i 7 gunde otomatik temizliyor; varsa
    // ona dokunma (kullanici eski olayi gormek isteyebilir).
    return;
  }

  // Gecici degisikleri stash et — kullanici dilerse geri alabilir.
  try {
    execSync("git stash push -u -m 'auto-rollback-stash'", {
      cwd: repoRoot,
      stdio: "ignore",
    });
  } catch {
    /* stash yoksa devam */
  }

  // Hedef commit'e geri don.
  try {
    execSync(`git checkout ${target}`, { cwd: repoRoot, stdio: "ignore" });
  } catch (e) {
    const rec: AutoRollbackRecord = {
      ts: Date.now(),
      oldHash: current,
      newHash: target,
      trigger,
      status: "failed",
      detail: `git checkout hatasi: ${(e as Error).message}`,
    };
    writeRecord(appDataDir, rec);
    emit("auto_rollback", { status: "failed", detail: rec.detail });
    return;
  }

  // Pending-update marker'i da yaz — yeni surec postUpdatePrompt akisini
  // calistirir; kontrol turunda durum kullaniciya ozetlenir.
  try {
    writeFileSync(
      join(appDataDir, "pending-update.json"),
      JSON.stringify({
        ts: Date.now(),
        not: `OTOMATIK ROLLBACK — sebep: ${trigger.reason}`,
        autoRollback: true,
      }),
      "utf8",
    );
  } catch {
    /* yoksay */
  }

  const rec: AutoRollbackRecord = {
    ts: Date.now(),
    oldHash: current,
    newHash: target,
    trigger,
    status: "ok",
  };
  writeRecord(appDataDir, rec);
  emit("auto_rollback", {
    status: "ok",
    oldHash: current.slice(0, 8),
    newHash: target.slice(0, 8),
    sebep: trigger.reason,
  });

  // Supervisor spawn — yeni surec ayaga kalkamazsa kendisi tekrar
  // last-good'a geri donmeyi dener (mevcut supervisor.js mantigi).
  const supervisor = join(repoRoot, "orchestrator", "supervisor.js");
  spawn(
    nodeExec,
    [supervisor, String(port), repoRoot, target, nodeExec, JSON.stringify(childArgs)],
    { detached: true, stdio: "ignore", windowsHide: true },
  ).unref();

  // 1.5s sonra kendimizi sonlandir — graceful shutdown'a sure ver.
  setTimeout(() => process.exit(0), 1500);
}
