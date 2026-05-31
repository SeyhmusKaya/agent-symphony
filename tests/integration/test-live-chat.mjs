// Integration (LIVE — real API call): Fix 104 model slug end-to-end.
// Sends "merhaba", waits for sef_cevap.
//
// !!! HOST-DEPENDENT TEST — DOES NOT RUN IN SANDBOX !!!
// The SDK (@anthropic-ai/claude-agent-sdk) spawns the `claude` CLI subprocess
// and depends on a HOST (ui.exe or Claude Code) for OAuth refresh
// (CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH=1). When spawned standalone with
// tsx/node there is no auth host -> query() hangs (75s+ no response).
// Also, if ANTHROPIC_API_KEY is set in this environment, SDK auth gets confused.
//
// CORRECT WAY TO RUN: with ui.exe open, send a message from the UI to a real
// project sef and watch the log. This mjs only works outside ui.exe with manual auth.
//
// Usage (if a host exists): node tests/integration/test-live-chat.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const PORT = 4398;
const projectRoot = mkdtempSync(join(tmpdir(), "arc-live-test-"));
const repoRoot = process.cwd();

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else { console.log(`FAIL  ${label}`); fail++; }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const child = spawn(
  "npx",
  ["tsx", "orchestrator/main.ts", String(PORT), projectRoot],
  { cwd: repoRoot, env: { ...process.env }, shell: true },
);
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

try {
  const up = await waitForPort(45000);
  check("orchestrator boot", up);
  if (!up) throw new Error("boot fail: " + stderrBuf.slice(-800));

  const result = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    let gotReply = false;
    let replyText = "";
    let errText = "";
    const t = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve({ gotReply, replyText, errText: errText || "timeout 90s" });
    }, 90000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ kind: "komut", text: "hello, introduce yourself in a single sentence", ekler: [] }));
    });
    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.kind === "sef_cevap") {
        gotReply = true;
        replyText = msg.text ?? "";
        clearTimeout(t); try { ws.close(); } catch {}
        resolve({ gotReply, replyText, errText });
      } else if (msg.kind === "event" && msg.event?.type === "hata") {
        errText += (msg.event.payload?.mesaj ?? "") + "\n";
      }
    });
    ws.on("error", (e) => reject(e));
  });

  check("sef_cevap arrived (model slug accepted)", result.gotReply);
  check("reply not empty", result.replyText.trim().length > 0);
  // NO 404 / model-not-found error
  const modelErr = /not.?found|404|does not exist|invalid.*model|model.*invalid/i.test(
    result.errText + stderrBuf,
  );
  check("NO model-not-found / 404 error", !modelErr);
  if (result.gotReply) {
    console.log(`\n[sef reply] ${result.replyText.slice(0, 200)}`);
  } else {
    console.log(`\n[ERROR] ${result.errText}`);
    console.log("--- stderr last 1200 ---\n" + stderrBuf.slice(-1200));
  }
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
