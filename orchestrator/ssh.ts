// Cok sunuculu kalici SSH baglantisi. Her sunucu id'sine ozel uzun-omurlu
// plink oturumu acilir; idle suresi dolunca kapatilir.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { appDataDir, repoRoot } from "./fleet.js";

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authType: "password" | "key";
  password?: string;
  privateKeyPath?: string;
  panelUrl?: string;
  tags: string[];
  notes?: string;
}

export interface SshResult {
  ok: boolean;
  out: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

const END = "__ARC_SSH_END_7F3A2D__";
const IDLE_KILL_MS = 600000; // 10 dk

interface Session {
  proc: ChildProcess | null;
  queue: Promise<SshResult>;
  idleTimer: NodeJS.Timeout | null;
}

const sessions = new Map<string, Session>();

function getSession(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { proc: null, queue: Promise.resolve(emptyResult()), idleTimer: null };
    sessions.set(id, s);
  }
  return s;
}

function emptyResult(): SshResult {
  return { ok: true, out: "", stdout: "", stderr: "", exitCode: 0 };
}

function killSession(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.idleTimer) {
    clearTimeout(s.idleTimer);
    s.idleTimer = null;
  }
  if (s.proc) {
    try { s.proc.kill(); } catch { /* ignore */ }
    s.proc = null;
  }
}

function serversFilePath(): string {
  return join(appDataDir(), "servers.json");
}

export function listServers(): Server[] {
  const f = serversFilePath();
  if (!existsSync(f)) {
    autoImportLegacyHetzner();
    if (!existsSync(f)) return [];
  }
  try {
    const raw = readFileSync(f, "utf8").trim();
    if (!raw) return [];
    return JSON.parse(raw) as Server[];
  } catch {
    return [];
  }
}

/** secrets.local.json icindeki eski hetzner alanini servers.json'a ilk kez tasi. */
function autoImportLegacyHetzner(): void {
  const secrets = join(repoRoot(), "secrets.local.json");
  if (!existsSync(secrets)) return;
  try {
    const data = JSON.parse(readFileSync(secrets, "utf8")) as {
      hetzner?: { host?: string; port?: number; user?: string; password?: string };
    };
    const h = data.hetzner;
    if (!h?.host || !h.user || !h.password) return;
    const srv: Server = {
      id: "legacy-hetzner",
      name: "Hetzner (legacy)",
      host: h.host,
      port: h.port ?? 22,
      user: h.user,
      authType: "password",
      password: h.password,
      tags: ["hetzner"],
    };
    writeFileSync(serversFilePath(), JSON.stringify([srv], null, 2), "utf8");
  } catch {
    /* yoksay */
  }
}

export function getServer(id: string): Server | null {
  return listServers().find((s) => s.id === id) ?? null;
}

/** "hetzner" alias'i veya gercek id ile sunucu id'sini cozer. */
export function resolveServerId(idOrAlias: string): string | null {
  const all = listServers();
  const exact = all.find((s) => s.id === idOrAlias);
  if (exact) return exact.id;
  const lower = idOrAlias.toLowerCase();
  const match = all.find(
    (s) =>
      s.tags.map((t) => t.toLowerCase()).includes(lower) ||
      s.name.toLowerCase().includes(lower),
  );
  return match?.id ?? null;
}

function ensureProc(srv: Server, s: Session): ChildProcess {
  if (s.proc && s.proc.exitCode === null && !s.proc.killed) return s.proc;
  // P1.33: -batch KALDIRILDI. -batch ile yeni server'lara host-key prompt'unda
  // anlik reject — silent fail → ssh_run 60sn timeout. Yerine:
  // 1) -batch'siz spawn → plink ilk baglantida y/n prompt yazar
  // 2) Sehirsel uyumluluk: stdin'e "y\n" yaz (eger prompt cikarsa yutulur,
  //    yoksa bash icine gidip no-op olur — `y` komutu olmadigi icin error
  //    yazar ama "exec 2>&1" sonrasi temizlenir)
  const args = ["-ssh", "-P", String(srv.port)];
  if (srv.authType === "password" && srv.password) {
    args.push("-pw", srv.password);
  } else if (srv.authType === "key" && srv.privateKeyPath) {
    args.push("-i", srv.privateKeyPath);
  }
  args.push(`${srv.user}@${srv.host}`, "bash");
  const p = spawn("plink", args, { windowsHide: true });
  p.on("exit", () => {
    if (s.proc === p) s.proc = null;
  });
  p.on("error", () => {
    if (s.proc === p) s.proc = null;
  });
  // Host-key prompt'unu yutmak icin "y\n" ile bashin "exec 2>&1" arasinda
  // kucuk gecikme. Ilk yazim prompt'a, ikincisi bash'e.
  p.stdin?.write("y\n");
  setTimeout(() => p.stdin?.write("exec 2>&1\n"), 200);
  s.proc = p;
  return p;
}

/**
 * Sunucu id'sinde komut calistirir. serverId "hetzner" gibi alias da olabilir.
 */
export function sshExec(
  serverId: string,
  komut: string,
  timeoutMs = 180000,
): Promise<SshResult> {
  const resolved = resolveServerId(serverId);
  if (!resolved) {
    return Promise.resolve({
      ok: false,
      out: `Sunucu bulunamadi: ${serverId}`,
      stdout: "",
      stderr: `Sunucu bulunamadi: ${serverId}`,
      exitCode: -1,
    });
  }
  const srv = getServer(resolved);
  if (!srv) {
    return Promise.resolve({
      ok: false,
      out: `Sunucu yapilandirma okunamadi: ${resolved}`,
      stdout: "",
      stderr: `Sunucu yapilandirma okunamadi: ${resolved}`,
      exitCode: -1,
    });
  }
  const s = getSession(resolved);

  const run = (): Promise<SshResult> =>
    new Promise<SshResult>((resolve) => {
      const p = ensureProc(srv, s);
      let buf = "";
      let done = false;

      const finish = (r: SshResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        p.stdout?.off("data", onData);
        if (s.idleTimer) clearTimeout(s.idleTimer);
        s.idleTimer = setTimeout(() => killSession(resolved), IDLE_KILL_MS);
        resolve(r);
      };

      const onData = (d: Buffer) => {
        buf += d.toString("utf8");
        const idx = buf.indexOf(END + ":");
        if (idx >= 0) {
          const tail = buf.slice(idx + END.length + 1);
          const nl = tail.indexOf("\n");
          if (nl < 0) return;
          const code = parseInt(tail.slice(0, nl).trim(), 10);
          const body = buf.slice(0, idx).replace(/\r/g, "").trim();
          finish({
            ok: code === 0,
            out: body,
            stdout: body,
            stderr: "",
            exitCode: code,
          });
        }
      };

      const timer = setTimeout(() => {
        // Teshis: TCP+auth genelde saglam; takilma cogu zaman SUNUCU-TARAFI
        // session-channel hang'i (disk dolu / systemd-logind / pam_motd). Mesaj
        // "ag/firewall" demesin — yaniltici. buf bos ise auth gectikten sonra
        // oturum acilmamis demektir.
        const ipucu = buf.trim()
          ? ""
          : " | Sunucu auth'u kabul edip oturum ACMIYOR olabilir (disk dolu / systemd-logind / pam). Hetzner console: df -h, systemctl status systemd-logind.";
        finish({
          ok: false,
          out: `SSH zaman asimi (${timeoutMs / 1000}s).${ipucu}\n${buf}`.trim(),
          stdout: buf,
          stderr: `timeout ${timeoutMs}ms`,
          exitCode: -1,
        });
        killSession(resolved);
      }, timeoutMs);

      p.stdout?.on("data", onData);
      p.once("exit", () =>
        finish({
          ok: false,
          out: `SSH baglantisi koptu.\n${buf}`.trim(),
          stdout: buf,
          stderr: "connection lost",
          exitCode: -1,
        }),
      );

      try {
        p.stdin?.write(`${komut}\necho "${END}:$?"\n`);
      } catch {
        finish({
          ok: false,
          out: "SSH stdin yazilamadi.",
          stdout: "",
          stderr: "stdin write failed",
          exitCode: -1,
        });
      }
    });

  s.queue = s.queue.then(run, run);
  return s.queue;
}
