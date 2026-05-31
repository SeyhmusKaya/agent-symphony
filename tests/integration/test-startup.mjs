// Integration: orchestrator boot + WS roundtrip.
// Verifies the runtime boot path did not break after F1.3b (specialist subprocess
// removed) + F9 (main.ts split). NO real API call — just the process comes up,
// WS opens, durum_iste -> durum payload returns.
//
// Usage: node tests/integration/test-startup.mjs
// Spawns orchestrator/main.ts <port> <projectRoot> with tsx.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const PORT = 4399;
const projectRoot = mkdtempSync(join(tmpdir(), "arc-boot-test-"));
const repoRoot = process.cwd();

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else { console.log(`FAIL  ${label}`); fail++; }
}

console.log(`[boot] spawn orchestrator port=${PORT} root=${projectRoot}`);
const child = spawn(
  "npx",
  ["tsx", "orchestrator/main.ts", String(PORT), projectRoot],
  { cwd: repoRoot, env: { ...process.env }, shell: true },
);

let stderrBuf = "";
child.stderr.on("data", (d) => { stderrBuf += d.toString(); });
let stdoutBuf = "";
child.stdout.on("data", (d) => { stdoutBuf += d.toString(); });

let exited = false;
let exitCode = null;
child.on("exit", (code) => { exited = true; exitCode = code; });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForPort(maxMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (exited) return false;
    try {
      const ok = await new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
        const t = setTimeout(() => { try { ws.close(); } catch {} resolve(false); }, 1500);
        ws.on("open", () => { clearTimeout(t); ws.close(); resolve(true); });
        ws.on("error", () => { clearTimeout(t); resolve(false); });
      });
      if (ok) return true;
    } catch { /* retry */ }
    await sleep(1000);
  }
  return false;
}

async function requestStatus() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch {} reject(new Error("durum timeout")); } }, 8000);
    ws.on("open", () => ws.send(JSON.stringify({ kind: "durum_iste" })));
    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.kind === "durum") {
        done = true; clearTimeout(t); try { ws.close(); } catch {}
        resolve(msg.payload);
      }
    });
    ws.on("error", (e) => { if (!done) { done = true; clearTimeout(t); reject(e); } });
  });
}

try {
  const up = await waitForPort(45000);
  check("orchestrator WS port opened (within 45s)", up);
  if (!up) {
    console.log("--- stderr (son 1500) ---\n" + stderrBuf.slice(-1500));
    console.log("--- stdout (son 800) ---\n" + stdoutBuf.slice(-800));
    console.log(`exited=${exited} exitCode=${exitCode}`);
    throw new Error("boot fail");
  }

  const status = await requestStatus();
  check("durum payload arrived", status && typeof status === "object");
  check("status.chief field present", !!status.chief);
  check("status.chief.model present", typeof status.chief?.model === "string");
  // F3: autonomousJobs field in the status payload (may be an empty array)
  check("status.autonomousJobs field present (F3)", Array.isArray(status.autonomousJobs));
  // F4: budgets field in the status payload
  check("status.budgets field present (F4)", status.budgets && typeof status.budgets === "object");
  check("status.sessions is array", Array.isArray(status.sessions));

  // Crash check: no fatal error in stderr.
  const fatal = /Cannot find module|is not a function|ReferenceError|TypeError:/i.test(stderrBuf);
  check("no fatal module/ref error in stderr", !fatal);
  if (fatal) console.log("--- stderr ---\n" + stderrBuf.slice(-2000));
} catch (e) {
  console.log("ERROR: " + (e?.message ?? String(e)));
  fail++;
} finally {
  try { child.kill("SIGTERM"); } catch {}
  await sleep(1500);
  try { child.kill("SIGKILL"); } catch {}
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch {}
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
