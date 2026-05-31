// Diagnostic: which model actually replies? Set the model via sef_model,
// send merhaba, wait for sef_cevap | hata. argv[2] = model slug.
// Usage: node tests/integration/test-live-model.mjs claude-sonnet-4-6

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const MODEL = process.argv[2] ?? "claude-sonnet-4-6";
const PORT = 4397;
const projectRoot = mkdtempSync(join(tmpdir(), "arc-model-test-"));
const repoRoot = process.cwd();
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const child = spawn("npx", ["tsx", "orchestrator/main.ts", String(PORT), projectRoot],
  { cwd: repoRoot, env: { ...process.env }, shell: true });
let stderrBuf = "";
child.stderr.on("data", (d) => { stderrBuf += d.toString(); });

async function waitForPort(maxMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      const t = setTimeout(() => { try { ws.close(); } catch {} resolve(false); }, 1500);
      ws.on("open", () => { clearTimeout(t); ws.close(); resolve(true); });
      ws.on("error", () => { clearTimeout(t); resolve(false); });
    });
    if (ok) return true;
    await sleep(1000);
  }
  return false;
}

const t0 = Date.now();
try {
  const up = await waitForPort(45000);
  if (!up) { console.log("BOOT FAIL"); process.exit(1); }
  console.log(`[boot ok] model=${MODEL}`);

  const res = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    let out = { reply: "", err: "", got: false };
    const t = setTimeout(() => { try { ws.close(); } catch {} resolve(out); }, 75000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ kind: "sef_model", model: MODEL, effort: "low" }));
      setTimeout(() => {
        ws.send(JSON.stringify({ kind: "komut", text: "hello", ekler: [] }));
      }, 500);
    });
    ws.on("message", (data) => {
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      if (m.kind === "sef_cevap") { out.got = true; out.reply = m.text ?? ""; clearTimeout(t); try { ws.close(); } catch {} resolve(out); }
      else if (m.kind === "event" && m.event?.type === "hata") out.err += (m.event.payload?.mesaj ?? "") + "\n";
    });
    ws.on("error", () => {});
  });

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.got) {
    console.log(`RESULT: OK (${secs}s) — "${res.reply.slice(0, 120)}"`);
  } else {
    console.log(`RESULT: HANG/FAIL (${secs}s)`);
    if (res.err) console.log("err: " + res.err.slice(0, 400));
    console.log("stderr last 600: " + stderrBuf.slice(-600));
  }
} finally {
  try { child.kill("SIGTERM"); } catch {}
  await sleep(1000);
  try { child.kill("SIGKILL"); } catch {}
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch {}
}
process.exit(0);
