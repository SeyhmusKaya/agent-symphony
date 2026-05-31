// Fix 93 TEST: tool girdi/sonuc mid-stream WS event.
// SCENARIO:
//   1. Give the sef a Read command: have it read a specific file
//   2. Listen to WS: sef_aktivite_io events should arrive (ioKind "girdi" + "sonuc")
//   3. girdi -> file_path, sonuc -> file content snippet
//   4. When done, sef_cevap segments tools[].girdi/sonuc must be filled (mid-stream consistency)
//
// Usage:
//   node tests/test-tool-detail.mjs [port]

import WebSocket from "ws";

const PORT = Number(process.argv[2] ?? 4318);
const TIMEOUT_MS = 120000;

function connect(port) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once("open", () => res(ws));
    ws.once("error", rej);
    setTimeout(() => rej(new Error("connect timeout")), 5000);
  });
}

function pass(msg) { console.log(`  PASS: ${msg}`); }
function fail(msg) { console.log(`  FAIL: ${msg}`); }
function info(msg) { console.log(`  ... ${msg}`); }

(async () => {
  console.log(`\n=== Fix 93 Tool Detail Test (port=${PORT}) ===`);
  let ws;
  try {
    ws = await connect(PORT);
  } catch (e) {
    console.error(`Connection failed: ${e.message}`);
    process.exit(2);
  }

  let testsRun = 0;
  let testsPassed = 0;

  const ioEvents = [];
  const aktiviteStartEvents = [];
  let cevap = null;

  function onMsg(raw) {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.kind === "sef_aktivite") aktiviteStartEvents.push(m);
    else if (m.kind === "sef_aktivite_io") ioEvents.push(m);
    else if (m.kind === "sef_cevap") cevap = m;
  }
  ws.on("message", onMsg);

  try {
    // Read command — have it read a file in the project so the Read tool fires
    const prompt = `Read the \`package.json\` file with the Read tool and tell me the value of its "name" field. Just write the name, do not use any other tool.`;
    ws.send(JSON.stringify({ kind: "komut", text: prompt }));

    info("waiting for sef_cevap...");
    const start = Date.now();
    while (!cevap && Date.now() - start < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!cevap) {
      fail("sef_cevap timeout");
      process.exit(1);
    }

    info(`turn completed (${Date.now() - start}ms)`);
    info(`activity start events: ${aktiviteStartEvents.length}`);
    info(`io events (Fix 93): ${ioEvents.length}`);

    // Test 1: sef_aktivite_io events fired
    testsRun++;
    if (ioEvents.length > 0) {
      pass(`sef_aktivite_io events received (${ioEvents.length})`);
      testsPassed++;
    } else {
      fail(`sef_aktivite_io NEVER received — Fix 93 backend patch did not work`);
    }

    // Test 2: girdi events
    const girdiEvents = ioEvents.filter((e) => e.ioKind === "girdi");
    testsRun++;
    if (girdiEvents.length > 0) {
      pass(`girdi events: ${girdiEvents.length}`);
      testsPassed++;
      info(`first girdi text: "${(girdiEvents[0].text ?? "").slice(0, 100)}"`);
    } else {
      fail(`no girdi event`);
    }

    // Test 3: sonuc events
    const sonucEvents = ioEvents.filter((e) => e.ioKind === "sonuc");
    testsRun++;
    if (sonucEvents.length > 0) {
      pass(`sonuc events: ${sonucEvents.length}`);
      testsPassed++;
      info(`first sonuc text (first 100 chars): "${(sonucEvents[0].text ?? "").slice(0, 100)}"`);
    } else {
      fail(`no sonuc event`);
    }

    // Test 4: id matching
    testsRun++;
    const girdiIds = new Set(girdiEvents.map((e) => e.id));
    const sonucIds = new Set(sonucEvents.map((e) => e.id));
    let matched = 0;
    for (const id of girdiIds) if (sonucIds.has(id)) matched++;
    if (matched > 0) {
      pass(`girdi/sonuc id matching: a full pair for ${matched} tool(s)`);
      testsPassed++;
    } else {
      fail(`no girdi/sonuc id matching — no match in the UI`);
    }

    // Test 5: are the reply segments girdi/sonuc filled (mid-stream consistency)
    testsRun++;
    let segmentToolsWithIO = 0;
    if (cevap.segments) {
      for (const seg of cevap.segments) {
        if (seg.kind === "tools") {
          for (const t of seg.tools) {
            if (t.girdi && t.sonuc) segmentToolsWithIO++;
          }
        }
      }
    }
    if (segmentToolsWithIO > 0) {
      pass(`girdi+sonuc filled in sef_cevap segments tools[]: ${segmentToolsWithIO}`);
      testsPassed++;
    } else {
      fail(`sef_cevap segments tools[] girdi/sonuc empty — final consistency error`);
    }

  } finally {
    ws.close();
  }

  console.log(`\n===== RESULT: ${testsPassed}/${testsRun} tests passed =====`);
  if (testsPassed < testsRun) {
    console.log("SOME TESTS FAILED — Fix 93 patch is missing.");
    process.exit(1);
  } else {
    console.log("ALL TESTS PASSED.");
    process.exit(0);
  }
})().catch((e) => {
  console.error(`Test runner crash: ${e.message}`);
  process.exit(2);
});
