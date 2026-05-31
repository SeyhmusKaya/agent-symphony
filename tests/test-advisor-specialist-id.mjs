// Fix 100 TEST: chief advisor/specialist identity distinction.
// SCENARIO:
//   1. Ask the chief "what is the difference between an advisor and a specialist?"
//   2. The reply should contain these CORRECT statements:
//      - "sabit 11" or "11 danisman" (number of advisors)
//      - advisor → "domain karar destek" / "kod yazmaz" / "oneri" or similar
//      - specialist → "create_agent" / "delegate" / "kod yazar" / "kalici" or similar
//      - "ben olustururum" / "sen kurarsin" / "proje sefine bagli" or similar
//   3. FORBIDDEN statements:
//      - "siber-guvenlik uzmani" (siber-guvenlik IS AN ADVISOR)
//      - "playwright/anti-bot danismani" (these count as SPECIALISTS)
//
// NOTE: the question prompt and the assertion regexes below are in Turkish on
// purpose — they are coupled (the agent answers in the prompt language and the
// regexes match that). Do not translate them or the assertions break.
//
// Usage:
//   node tests/test-advisor-specialist-id.mjs [port]

import WebSocket from "ws";

const PORT = Number(process.argv[2] ?? 4321);
const TIMEOUT_MS = 240000;

const SORU =
  "Sistemde danisman ve uzman ne fark? Hangileri sabit, hangileri sen olusturursun? " +
  "Hangileri kod yazar, hangileri sadece bilgi/oneri verir? " +
  "Cagri yontemleri ayri mi? Net acikla, kisa.";

function connect(port) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once("open", () => res(ws));
    ws.once("error", rej);
    setTimeout(() => rej(new Error("connect timeout")), 5000);
  });
}

function send(ws, text, timeout = TIMEOUT_MS) {
  return new Promise((res, rej) => {
    const tm = setTimeout(() => {
      ws.off("message", onm);
      rej(new Error("sef_cevap timeout"));
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

function pass(msg) { console.log(`  PASS: ${msg}`); }
function fail(msg) { console.log(`  FAIL: ${msg}`); }

(async () => {
  console.log(`\n=== Fix 100 Advisor/Specialist Identity Test (port=${PORT}) ===`);
  let ws;
  try {
    ws = await connect(PORT);
  } catch (e) {
    console.error(`Connection failed: ${e.message}`);
    process.exit(2);
  }

  try {
    // clean state via /clear
    ws.send(JSON.stringify({ kind: "komut", text: "/clear" }));
    await new Promise((r) => setTimeout(r, 3000));

    const r = await send(ws, SORU);
    const t = (r.text ?? "").toLowerCase();
    console.log(`\nreply first 800 chars: "${t.slice(0, 800)}"\n`);

    let testsRun = 0;
    let testsPassed = 0;

    // Test 1: "sabit 11" or "11 advisor/danisman"
    testsRun++;
    if (/\b11\b/.test(t) && (/sabit|fix|degismez/i.test(t))) {
      pass(`"sabit 11 danisman" statement present`);
      testsPassed++;
    } else {
      fail(`no "sabit 11" reference — advisor count unclear`);
    }

    // Test 2: for advisor, "kod yazmaz" / "oneri" / "karar destek" or similar
    testsRun++;
    const advisorRole = /domain|karar\s+destek|oneri|analiz|bilgi.*ver|kod\s+yazma|tool\s+kullanm|sadece\s+(bilgi|oneri)/i;
    if (advisorRole.test(t)) {
      pass(`advisor role explanation present (oneri/karar destek)`);
      testsPassed++;
    } else {
      fail(`advisor role explanation missing`);
    }

    // Test 3: for specialist, "delegate" or "create_agent" or "kod yazar"
    testsRun++;
    if (/delegate|create_agent|kod\s+yazar|dosya\s+edit|uretim/i.test(t)) {
      pass(`specialist role explanation present (code production)`);
      testsPassed++;
    } else {
      fail(`specialist role explanation missing`);
    }

    // Test 4: NO MIX-UP — must not state "siber-guvenlik uzmani"
    testsRun++;
    const bad1 = /siber[-\s]guvenlik\s+uzman/i;
    if (!bad1.test(r.text ?? "")) {
      pass(`NO "siber-guvenlik uzmani" mix-up (correct: advisor)`);
      testsPassed++;
    } else {
      fail(`"siber-guvenlik uzmani" mix-up detected — siber-guvenlik is an ADVISOR`);
    }

    // Test 5: call-method difference — "talk_to_chief" for advisor, "delegate" for specialist
    testsRun++;
    const hasTalkToChief = /talk_to_chief/i.test(r.text ?? "");
    const hasDelegate = /delegate/i.test(r.text ?? "");
    if (hasTalkToChief && hasDelegate) {
      pass(`two separate call methods (talk_to_chief + delegate) stated`);
      testsPassed++;
    } else {
      fail(`call-method distinction missing (talk_to_chief=${hasTalkToChief}, delegate=${hasDelegate})`);
    }

    console.log(`\n===== RESULT: ${testsPassed}/${testsRun} tests passed =====`);
    if (testsPassed < testsRun) process.exit(1);
    else process.exit(0);
  } finally {
    ws.close();
  }
})().catch((e) => {
  console.error(`Crash: ${e.message}`);
  process.exit(2);
});

