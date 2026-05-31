// Fix 94 TEST: pre-pause recall preservation before rebuild.
// SCENARIO:
//   1. Tell the sef 3 unique keywords (chat accumulates in state.json)
//   2. Manually send `kontrol:duraklat` to the sef (the step rebuild_ui performs)
//   3. Check state.json:
//      - needsContextPrepend == TRUE
//      - recentTurnsFragment contains the first keyword
//   4. (Since there is no real rebuild, simulate it: send the devam control)
//   5. New command: "which keyword in the first turn?" → the agent should answer correctly
//
// This test SIMULATES rebuild; it does not do a real tauri-build. It verifies
// that the needsContextPrepend flag write is triggered correctly and that the
// prepend is applied on the next user message.
//
// NOTE: the prompts below are Turkish on purpose (coupled fixtures). Do not
// translate them — the keyword-echo assertions depend on the prompt.
//
// Usage:
//   node tests/test-rebuild-memory.mjs [port]

import WebSocket from "ws";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.argv[2] ?? 4321);
const TIMEOUT_MS = 120000;

const KELIMELER = ["GALATASURAY7", "OSIRISBEAM", "PYTHAGOREA"];

function connect(port) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once("open", () => res(ws));
    ws.once("error", rej);
    setTimeout(() => rej(new Error(`connect timeout port=${port}`)), 5000);
  });
}

function send(ws, text, timeout = TIMEOUT_MS) {
  return new Promise((res, rej) => {
    const tm = setTimeout(() => {
      ws.off("message", onm);
      rej(new Error(`timeout: ${text.slice(0, 30)}`));
    }, timeout);
    function onm(raw) {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.kind === "sef_cevap") {
        clearTimeout(tm);
        ws.off("message", onm);
        res(m);
      }
    }
    ws.on("message", onm);
    ws.send(JSON.stringify({ kind: "komut", text }));
  });
}

function sendControl(ws, aksiyon) {
  ws.send(JSON.stringify({ kind: "kontrol", aksiyon }));
}

function readStateJson(port) {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  const runningPath = join(appData, "com.seyh.architect", "running.json");
  if (!existsSync(runningPath)) return null;
  try {
    const running = JSON.parse(readFileSync(runningPath, "utf8"));
    const entry = running.find((r) => r.port === port);
    if (!entry) return null;
    const sessionsDir = join(entry.path, ".team", "sessions");
    const indexPath = join(sessionsDir, "index.json");
    if (!existsSync(indexPath)) return null;
    const idx = JSON.parse(readFileSync(indexPath, "utf8"));
    const primary = (idx.sessions ?? []).find((s) => s.role === "primary");
    if (!primary) return null;
    const statePath = join(sessionsDir, primary.id, "state.json");
    if (!existsSync(statePath)) return null;
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch (e) {
    return null;
  }
}

function pass(msg) { console.log(`  PASS: ${msg}`); }
function fail(msg) { console.log(`  FAIL: ${msg}`); }
function info(msg) { console.log(`  ... ${msg}`); }

(async () => {
  console.log(`\n=== Fix 94 Rebuild Pre-Pause Memory Test (port=${PORT}) ===`);
  let ws;
  try {
    ws = await connect(PORT);
  } catch (e) {
    console.error(`Connection failed: ${e.message}`);
    process.exit(2);
  }

  let testsRun = 0;
  let testsPassed = 0;

  try {
    // /clear first (clean state)
    console.log("\n[SETUP] Cleanup via /clear...");
    ws.send(JSON.stringify({ kind: "komut", text: "/clear" }));
    await new Promise((r) => setTimeout(r, 3000));

    // PHASE 1: register keywords
    console.log("\n[PHASE 1] Registering 3 keywords...");
    for (let i = 0; i < KELIMELER.length; i++) {
      const k = KELIMELER[i];
      const r = await send(ws, `Hafizana al: "${k}". Sadece "tamam, ${k}" de.`);
      testsRun++;
      if (new RegExp(k, "i").test(r.text)) {
        pass(`turn ${i + 1}: "${k}" echo`);
        testsPassed++;
      } else {
        fail(`turn ${i + 1}: "${k}" not echoed`);
      }
    }

    // PHASE 2: rebuild simulation — pause control (Fix 94 rebuild_ui step)
    console.log("\n[PHASE 2] Pre-pause control (rebuild simulation)...");
    sendControl(ws, "duraklat");
    info("kontrol:duraklat sent");
    await new Promise((r) => setTimeout(r, 2500)); // state.json write

    const stateAfterPause = readStateJson(PORT);
    testsRun++;
    if (stateAfterPause && stateAfterPause.needsContextPrepend === true) {
      pass(`needsContextPrepend = TRUE`);
      testsPassed++;
    } else {
      fail(`needsContextPrepend wrong (state=${stateAfterPause ? JSON.stringify(stateAfterPause).slice(0, 150) : "null"})`);
    }

    testsRun++;
    if (stateAfterPause?.recentTurnsFragment?.includes(KELIMELER[0])) {
      pass(`recentTurnsFragment contains "${KELIMELER[0]}"`);
      testsPassed++;
    } else {
      fail(`recentTurnsFragment does not contain "${KELIMELER[0]}" (frag=${stateAfterPause?.recentTurnsFragment?.slice(0, 200) ?? "none"})`);
    }

    testsRun++;
    if (stateAfterPause?.recentTurnsFragment?.includes(KELIMELER[1]) &&
        stateAfterPause?.recentTurnsFragment?.includes(KELIMELER[2])) {
      pass(`recentTurnsFragment contains the other 2 keywords (3 raw turns)`);
      testsPassed++;
    } else {
      fail(`recentTurnsFragment missing the 2nd and 3rd keywords`);
    }

    // PHASE 3: resume + recall
    console.log("\n[PHASE 3] Resume + recall...");
    sendControl(ws, "devam");
    await new Promise((r) => setTimeout(r, 1500));

    const rRecall = await send(ws, `Az once ilk turn'de hangi kelimeyi soyledim? Tam kelimeyi yaz.`);
    testsRun++;
    info(`agent reply: "${rRecall.text.slice(0, 200)}"`);
    if (new RegExp(KELIMELER[0], "i").test(rRecall.text)) {
      pass(`"${KELIMELER[0]}" recalled after pre-pause`);
      testsPassed++;
    } else {
      fail(`first keyword not recalled after pre-pause`);
    }

    // flag cleared
    const stateFinal = readStateJson(PORT);
    testsRun++;
    if (stateFinal?.needsContextPrepend === false) {
      pass(`needsContextPrepend = FALSE after inject`);
      testsPassed++;
    } else {
      fail(`flag not cleared after inject`);
    }

  } finally {
    ws.close();
  }

  console.log(`\n===== RESULT: ${testsPassed}/${testsRun} tests passed =====`);
  if (testsPassed < testsRun) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})().catch((e) => {
  console.error(`Crash: ${e.message}`);
  process.exit(2);
});
