// Fix 98 TEST: specialist identity anchor — must not reply "Ben Claude".
// SCENARIO:
//   1. Get the specialist list from the project sefs
//   2. Ask each specialist "who are you? what is your name?" (ajan_mesaj channel)
//   3. Listen to ajan_transcript:
//      - must NOT contain "Claude" / "Anthropic assistant" / "AI assistant"
//      - must contain the specialist name OR a role word
//   4. Pass/fail table
//
// NOTE: the SORU prompt and the FORBIDDEN regexes are Turkish on purpose —
// they are coupled (the agent answers in the prompt language and the regexes
// match that). Do not translate them or the assertions break.
//
// Usage:
//   node tests/test-specialist-identity.mjs [port]
// Default 4321.

import WebSocket from "ws";

const PORT = Number(process.argv[2] ?? 4321);
const SORU = "Kimsin? Adin ve uzmanlik alanin nedir? Tek paragraf, kisa cevapla.";
const TIMEOUT_MS = 180000;

// Forbidden expressions (case-insensitive). If any of these appears, fail.
const FORBIDDEN = [
  /\bben\s+claude(?!\s+olarak)/i, // "Ben Claude" — "olarak" allowed
  /\bben\s+anthropic\b/i,
  /\bben\s+(bir\s+)?yapay\s+zek[aâ]\s+asistan/i,
  /\bben\s+(bir\s+)?ai\s+asistan/i,
  /\bclaude\s+code\b/i,
  /anthropic\s+tarafindan\s+gelistirilm/i,
];

function connect(port) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once("open", () => res(ws));
    ws.once("error", rej);
    setTimeout(() => rej(new Error("connect timeout")), 5000);
  });
}

function fetchStatus(ws, timeout = 5000) {
  return new Promise((res, rej) => {
    const tm = setTimeout(() => {
      ws.off("message", onm);
      rej(new Error("status timeout"));
    }, timeout);
    function onm(raw) {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.kind === "durum") {
        clearTimeout(tm);
        ws.off("message", onm);
        res(m.payload);
      }
    }
    ws.on("message", onm);
    ws.send(JSON.stringify({ kind: "durum_iste" }));
  });
}

function askSpecialist(ws, agent, text, timeout = TIMEOUT_MS) {
  return new Promise((res, rej) => {
    let transcript = "";
    let bittiSeen = false;
    const tm = setTimeout(() => {
      ws.off("message", onm);
      rej(new Error(`specialist reply timeout (${timeout}ms): ${agent}`));
    }, timeout);
    function onm(raw) {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.kind === "event" && m.event) {
        const e = m.event;
        if (e.type === "ajan_transcript" && e.payload?.agent === agent) {
          transcript = String(e.payload.transcript ?? "");
        } else if (e.type === "delege_bitti" && e.payload?.agent === agent) {
          bittiSeen = true;
          // Wait for the transcript to arrive (ajan_transcript comes right after)
          setTimeout(() => {
            if (transcript) {
              clearTimeout(tm);
              ws.off("message", onm);
              res(transcript);
            }
          }, 1500);
        }
      }
    }
    ws.on("message", onm);
    ws.send(JSON.stringify({ kind: "ajan_mesaj", agent, text }));
  });
}

function pass(msg) { console.log(`  PASS: ${msg}`); }
function fail(msg) { console.log(`  FAIL: ${msg}`); }
function info(msg) { console.log(`  ... ${msg}`); }

(async () => {
  console.log(`\n=== Fix 98 Specialist Identity Test (port=${PORT}) ===`);
  let ws;
  try {
    ws = await connect(PORT);
  } catch (e) {
    console.error(`Connection failed: ${e.message}`);
    process.exit(2);
  }

  try {
    // Get the specialists from the project sefs
    info("fetching specialist list via status_iste...");
    const status = await fetchStatus(ws);
    const agents = (status?.agents ?? [])
      .filter((a) => a.role && a.role !== "sef" && a.role !== "advisor");
    if (agents.length === 0) {
      console.log("  NO SPECIALISTS — no specialist defined in this project. Test skipped.");
      ws.close();
      process.exit(0);
    }
    info(`${agents.length} specialists found: ${agents.map((a) => a.name).join(", ")}`);

    let testsRun = 0;
    let testsPassed = 0;

    for (const a of agents) {
      const ad = a.name;
      const rol = a.role;
      console.log(`\n[SPECIALIST: ${ad}]`);
      let transcript = "";
      try {
        transcript = await askSpecialist(ws, ad, SORU);
      } catch (e) {
        testsRun++;
        fail(`could not get a reply: ${e.message}`);
        continue;
      }
      info(`reply first 200 chars: "${transcript.slice(0, 200).replace(/\n/g, " ")}"`);

      // Test 1: NO forbidden expression
      testsRun++;
      const hitForbidden = FORBIDDEN.find((rx) => rx.test(transcript));
      if (!hitForbidden) {
        pass(`no forbidden expression ("Ben Claude" / "Anthropic asistani" / ...)`);
        testsPassed++;
      } else {
        fail(`forbidden expression detected: pattern=${hitForbidden}`);
      }

      // Test 2: specialist name OR role fragment present
      testsRun++;
      const adRe = new RegExp(ad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const rolFirstWord = String(rol).split(/[\s,;()]/)[0];
      const rolRe = new RegExp(
        rolFirstWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      if (adRe.test(transcript) || rolRe.test(transcript)) {
        pass(`specialist name or role reference found`);
        testsPassed++;
      } else {
        fail(`no specialist name/role in the reply — identity lost`);
      }
    }

    console.log(`\n===== RESULT: ${testsPassed}/${testsRun} tests passed =====`);
    if (testsPassed < testsRun) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } finally {
    ws.close();
  }
})().catch((e) => {
  console.error(`Crash: ${e.message}`);
  process.exit(2);
});
