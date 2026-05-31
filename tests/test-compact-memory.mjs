// Fix 95 TEST: memory preservation after compact.
// SCENARIO:
//   1. Send the sef 5 messages on 5 different topics (each with a unique keyword)
//   2. Send /compact, expect a summary
//   3. After compact, send 5 separate queries: "what did I just say about X?"
//   4. VERIFY that each reply contains the relevant keyword/theme
// OUTPUT: PASS / FAIL detailed report (an agent-reply snippet per turn).
//
// NOTE: the prompts below and the recall assertion regexes are Turkish on
// purpose — they are coupled (the agent answers in the prompt language and the
// regexes match that). Do not translate them or the assertions break.
//
// Usage:
//   node tests/test-compact-memory.mjs [port]
// Default port 4318 (Volpora-Chief). Pass a port argument for a different project.

import WebSocket from "ws";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.argv[2] ?? 4318);
const TIMEOUT_MS = 240000;
const COMPACT_TIMEOUT_MS = 360000;

// Test data: unique themes the agent will not confuse.
const TOPICS = [
  { kelime: "BIENNALE2089", soru: "main theme of the 2089 Venice Biennale" },
  { kelime: "ZUCCHINIBOMB", soru: "zucchini popped-bomb recipe" },
  { kelime: "KAILASA9", soru: "Kailasa item number 9" },
  { kelime: "QUASAR3C273", soru: "Quasar 3C273 brightness value" },
  { kelime: "NEPHELE", soru: "Greek source of the Nephele myth" },
];

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

function readStateJson(port) {
  // Find rootDir from the fleet running.json under appData/com.seyh.architect, then read .team/sessions/<primary>/state.json.
  // Simple approach: the running entry whose port matches, across all projects.
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
  console.log(`\n=== Fix 95 Compact Memory Test (port=${PORT}) ===`);
  let ws;
  try {
    ws = await connect(PORT);
  } catch (e) {
    console.error(`Connection failed: ${e.message}`);
    console.error(`Is the UI running? Is there an orchestrator on port ${PORT}?`);
    process.exit(2);
  }

  let testsRun = 0;
  let testsPassed = 0;

  try {
    // PHASE 1: build 5 turns
    console.log("\n[PHASE 1] Creating turns on 5 different topics...");
    for (let i = 0; i < TOPICS.length; i++) {
      const t = TOPICS[i];
      const prompt = `Sana bir test verisi soyleyecegim, hafizana al ama hicbir tool kullanma: "${t.kelime}". Sadece "tamam, ${t.kelime} aldim" diye cevapla.`;
      const r = await send(ws, prompt);
      const okPattern = new RegExp(t.kelime, "i").test(r.text);
      testsRun++;
      if (okPattern) {
        pass(`turn ${i + 1} "${t.kelime}" — agent echoed the keyword`);
        testsPassed++;
      } else {
        fail(`turn ${i + 1} "${t.kelime}" — agent did not echo: "${r.text.slice(0, 80)}"`);
      }
    }

    // PHASE 2: /compact
    console.log("\n[PHASE 2] Triggering /compact...");
    const rc = await send(ws, "/compact", COMPACT_TIMEOUT_MS);
    testsRun++;
    if (/derlen|ozet|summary/i.test(rc.text)) {
      pass(`compact response received (${rc.text.length} chars)`);
      testsPassed++;
    } else {
      fail(`unexpected compact response: "${rc.text.slice(0, 100)}"`);
    }

    // verify state.json
    const state = readStateJson(PORT);
    testsRun++;
    if (state && state.compactSummary && state.compactSummary.length > 200) {
      pass(`state.json compactSummary saved (${state.compactSummary.length} chars)`);
      testsPassed++;
      info(`summary first 200 chars: "${state.compactSummary.slice(0, 200)}"`);
    } else {
      fail(`state.json compactSummary empty or too short (state=${state ? JSON.stringify(state).slice(0, 150) : "null"})`);
    }

    testsRun++;
    if (state && state.needsContextPrepend === true) {
      pass(`needsContextPrepend flag TRUE (will inject on the next turn)`);
      testsPassed++;
    } else {
      fail(`needsContextPrepend flag FALSE or missing — Fix 95 patch did not work`);
    }

    // wait 3 seconds (compact file write)
    await new Promise((r) => setTimeout(r, 3000));

    // PHASE 3: post-compact recall test
    console.log("\n[PHASE 3] Post-compact recall test...");

    // first question: GENERAL "what did we discuss" check
    const rRecall1 = await send(ws, "Az once sana hangi kelimeleri soyledim? Liste yap, tool kullanma.");
    testsRun++;
    const matchedCount = TOPICS.filter((t) => new RegExp(t.kelime, "i").test(rRecall1.text)).length;
    info(`agent reply: "${rRecall1.text.slice(0, 300)}"`);
    if (matchedCount >= 3) {
      pass(`general recall: ${matchedCount}/${TOPICS.length} keywords detected`);
      testsPassed++;
    } else {
      fail(`general recall failed: only ${matchedCount}/${TOPICS.length} keywords detected`);
    }

    // Did the needsContextPrepend flag go down? (should be false after inject)
    const stateAfter = readStateJson(PORT);
    testsRun++;
    if (stateAfter && stateAfter.needsContextPrepend === false) {
      pass(`needsContextPrepend flag returned to FALSE after inject`);
      testsPassed++;
    } else {
      fail(`needsContextPrepend still TRUE or missing — not cleared`);
    }

    // PHASE 4: single queries
    console.log("\n[PHASE 4] One-by-one topic queries...");
    for (const t of TOPICS) {
      const r = await send(ws, `Az once "${t.kelime}" diye bir kelime soyledim mi? EVET veya HAYIR de, sebebini kisa anlat. Tool kullanma.`);
      testsRun++;
      const said = /\bevet\b/i.test(r.text) || new RegExp(t.kelime, "i").test(r.text);
      if (said) {
        pass(`"${t.kelime}" recalled`);
        testsPassed++;
      } else {
        fail(`"${t.kelime}" not recalled: "${r.text.slice(0, 120)}"`);
      }
    }

  } finally {
    ws.close();
  }

  console.log(`\n===== RESULT: ${testsPassed}/${testsRun} tests passed =====`);
  if (testsPassed < testsRun) {
    console.log("SOME TESTS FAILED — Fix 95 patch is missing or broken.");
    process.exit(1);
  } else {
    console.log("ALL TESTS PASSED.");
    process.exit(0);
  }
})().catch((e) => {
  console.error(`Test runner crash: ${e.message}`);
  process.exit(2);
});
