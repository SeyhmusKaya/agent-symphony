// Fix 95 TEST: memory preservation after pause/interrupt.
// SCENARIO:
//   1. Tell the sef 3 turns of unique keywords
//   2. Start a long tool-heavy command ("give a list" + nested talk_to_chief simulation)
//   3. Send a mid-stream pause (kontrol: duraklat)
//   4. Resume (kontrol: devam) — clear the pause state
//   5. Send a new command: "which keyword did I say in the first turn?"
//   6. The agent should return the EXACT text of the KEYWORD (via Fix 95 inject).
//
// NOTE: the prompts below are Turkish on purpose (coupled fixtures). Do not
// translate them — the keyword-echo assertions depend on the prompt.
//
// Usage:
//   node tests/test-pause-memory.mjs [port]
// Default port 4318.

import WebSocket from "ws";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.argv[2] ?? 4318);
const TIMEOUT_MS = 180000;
const PAUSE_DELAY_MS = 8000; // trigger pause during the long command

const KELIMELER = ["ZIRKONHELYO", "PETRICHOR", "MNEMONOS"];

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
      rej(new Error(`sef_cevap timeout (${timeout}ms): "${text.slice(0, 40)}"`));
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

function sendCommandFireForget(ws, text) {
  ws.send(JSON.stringify({ kind: "komut", text }));
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

function waitForIdle(ws, timeout = 60000) {
  return new Promise((res, rej) => {
    const tm = setTimeout(() => {
      ws.off("message", onm);
      rej(new Error("sef_tamamen_idle timeout"));
    }, timeout);
    function onm(raw) {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.kind === "sef_tamamen_idle" || m.kind === "sef_idle") {
        clearTimeout(tm);
        ws.off("message", onm);
        res();
      }
    }
    ws.on("message", onm);
  });
}

function pass(msg) { console.log(`  PASS: ${msg}`); }
function fail(msg) { console.log(`  FAIL: ${msg}`); }
function info(msg) { console.log(`  ... ${msg}`); }

(async () => {
  console.log(`\n=== Fix 95 Pause Memory Test (port=${PORT}) ===`);
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
    // PHASE 1: register keywords
    console.log("\n[PHASE 1] Registering 3 unique keywords...");
    for (let i = 0; i < KELIMELER.length; i++) {
      const k = KELIMELER[i];
      const r = await send(ws, `Hafizana al: "${k}". Sadece "tamam, ${k} aldim" de.`);
      testsRun++;
      if (new RegExp(k, "i").test(r.text)) {
        pass(`turn ${i + 1}: "${k}" echoed`);
        testsPassed++;
      } else {
        fail(`turn ${i + 1}: "${k}" not echoed`);
      }
    }

    // PHASE 2: start a long command, mid-stream pause
    console.log("\n[PHASE 2] Long command + mid-stream pause...");
    const longCmd = "Bir liste yap: 1-100 arasi tum asal sayilari say. Tek tek listele. Aceleci olma.";
    sendCommandFireForget(ws, longCmd);
    info(`long command sent; pause will be issued after ${PAUSE_DELAY_MS}ms`);
    await new Promise((r) => setTimeout(r, PAUSE_DELAY_MS));
    sendControl(ws, "duraklat");
    info("pause control sent");
    await new Promise((r) => setTimeout(r, 4000)); // pause settle

    // state.json check: needsContextPrepend flag should be TRUE
    const stateAfterPause = readStateJson(PORT);
    testsRun++;
    if (stateAfterPause && stateAfterPause.needsContextPrepend === true) {
      pass(`needsContextPrepend=TRUE after pause`);
      testsPassed++;
    } else {
      fail(`needsContextPrepend FALSE/missing after pause — Fix 95 pause patch did not work (state=${stateAfterPause ? JSON.stringify(stateAfterPause).slice(0, 150) : "null"})`);
    }

    testsRun++;
    if (stateAfterPause && stateAfterPause.recentTurnsFragment && stateAfterPause.recentTurnsFragment.includes(KELIMELER[0])) {
      pass(`recentTurnsFragment contains the first keyword`);
      testsPassed++;
    } else {
      fail(`recentTurnsFragment does not contain the first keyword (frag=${stateAfterPause?.recentTurnsFragment?.slice(0, 200) ?? "none"})`);
    }

    // PHASE 3: resume + recall
    console.log("\n[PHASE 3] Resume + recall test...");
    sendControl(ws, "devam");
    await new Promise((r) => setTimeout(r, 1500));

    // The prime list may have completed first, wait a bit
    info("waiting for idle (let the prime list finish if any)...");
    try { await waitForIdle(ws, 30000); } catch { /* continue */ }

    const rRecall = await send(ws, `Az once ilk turn'de hangi kelimeyi soylemistim hafizana almani istemistim? Tam kelimeyi yaz, tool kullanma.`);
    testsRun++;
    info(`agent reply: "${rRecall.text.slice(0, 250)}"`);
    if (new RegExp(KELIMELER[0], "i").test(rRecall.text)) {
      pass(`first keyword ("${KELIMELER[0]}") recalled after pause`);
      testsPassed++;
    } else {
      fail(`first keyword not recalled after pause`);
    }

    // PHASE 4: did the needsContextPrepend flag go down after inject
    const stateFinal = readStateJson(PORT);
    testsRun++;
    if (stateFinal && stateFinal.needsContextPrepend === false) {
      pass(`needsContextPrepend=FALSE after inject`);
      testsPassed++;
    } else {
      fail(`needsContextPrepend still TRUE/missing after inject — flag not cleared`);
    }

  } finally {
    ws.close();
  }

  console.log(`\n===== RESULT: ${testsPassed}/${testsRun} tests passed =====`);
  if (testsPassed < testsRun) {
    console.log("SOME TESTS FAILED — Fix 95 pause patch is missing or broken.");
    process.exit(1);
  } else {
    console.log("ALL TESTS PASSED.");
    process.exit(0);
  }
})().catch((e) => {
  console.error(`Test runner crash: ${e.message}`);
  process.exit(2);
});
