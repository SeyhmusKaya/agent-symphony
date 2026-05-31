// Orchestrator process lock — ayni proje icin paralel orchestrator
// calismasini engeller. Tauri rebuild_ui / restart_self sonrasi orphan PID
// kalabilir → stale lock devralma. F9 ek parcalama.

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * Lock dosyasini kontrol et + sahiplen. Eger ayni proje icin baska bir
 * orchestrator gercekten dinliyorsa process exit(1). Stale lock (PID
 * recycle / farkli port) devralinir.
 */
export function acquireLock(lockFile: string, port: number): void {
  if (existsSync(lockFile)) {
    const raw = readFileSync(lockFile, "utf8").trim();
    const [pidStr, portStr] = raw.split(/\s+/);
    const lockedPid = Number(pidStr);
    const lockedPort = Number(portStr);
    let alive = false;
    try {
      process.kill(lockedPid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    // Stale-lock fix: lock alive olsa bile bizim AYNI port'a baglanmiyorsa
    // (Tauri yeni port atadi cunku eski orphan farkli port tutuyor) lock'u
    // devral. PID gercekten ayni port'taysa zaten asagidaki bind hatasi
    // ile process exit eder.
    if (alive && Number.isFinite(lockedPort) && lockedPort === port) {
      // P1.33: PID-recycle yarisi — eski global oldu, OS PID'i baska
      // child'a (orn. project chief) verdi, eski lock o PID'i alive
      // gosteriyor. Port'ta gercekten dinleyici yoksa lock stale.
      // Dogrulama: lockedPort'a senkron TCP connect; basarisizsa devral.
      let portInUse = false;
      try {
        const out = execSync(
          `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count"`,
          { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
        );
        portInUse = Number(out.trim()) > 0;
      } catch {
        // Komut basarisiz — guvenli taraf: alive PID + lockedPort eslesir
        // ise yine de cikis yap.
        portInUse = true;
      }
      if (portInUse) {
        console.error(`Bu proje icin orkestrator zaten calisiyor (pid ${lockedPid}, port ${lockedPort}).`);
        process.exit(1);
      }
      console.log(`Stale lock devralindi: pid ${lockedPid} alive ama port ${lockedPort} bos (PID recycle).`);
    }
    // alive=false (recycled pid) veya farkli port → stale, devral.
  }
  writeFileSync(lockFile, `${process.pid} ${port}`, "utf8");
}

/** Lock dosyasini sil — graceful shutdown'da cagrilir. Hata yoksayilir. */
export function releaseLockFile(lockFile: string): void {
  try {
    if (existsSync(lockFile)) unlinkSync(lockFile);
  } catch {
    /* yoksay */
  }
}
