// t06 — EmlakCopilot LIVE test (port argv, default 4323).
// Purpose: after restart, observe Fix 145 (DUPLICATE), Fix 141 (Agent card name),
// and async delegation (delege_arkaplan) behavior.
// Command: a real specialist task -> the sef should delegate.
import { connect, collect, sendKomut, sleep } from "./_ws.mjs";

const PORT = Number(process.argv[2]) || 4323;
const TASK = process.argv[3] ||
  "Review the README file in the project and produce a 2-3 sentence summary. Delegate this job to a suitable specialist.";

const ws = await connect(PORT, 8000);
const c = collect(ws);

const agentCalls = [];   // Agent tool activities {id,durum}
const ioGirdi = [];      // sef_aktivite_io girdi {id,text}
const delegeTools = [];  // delege_arkaplan / Agent names

c.onAny((m) => {
  if (m.kind === "sef_aktivite" && m.ad) {
    if (/agent/i.test(m.ad) || /delege/i.test(m.ad)) {
      agentCalls.push({ ad: m.ad, durum: m.durum, id: m.id });
    }
  }
  if (m.kind === "sef_aktivite_io" && m.ioKind === "girdi") {
    ioGirdi.push({ id: m.id, text: (m.text || "").slice(0, 200) });
  }
});

console.log(`[t06] port=${PORT} sending command...`);
sendKomut(ws, TASK);

const r = await c.waitForCevap(180000);
await sleep(2000); // let queued/async events settle

// Analysis
const cevapMetni = c.deltas.join("");
const cevapKez = c.raw.filter((m) => m.kind === "sef_cevap").length;

console.log("\n===== T06 EMLAKCOPILOT LIVE =====");
console.log("waitForCevap   :", r);
console.log("sef_cevap count:", cevapKez, cevapKez === 1 ? "[SINGLE - no duplicate]" : "[!!! DUPLICATE]");
console.log("Agent/delege activity count:", agentCalls.length);
for (const a of agentCalls) console.log("   -", a.ad, "/", a.durum, "/ id=" + a.id);
console.log("io girdi event count:", ioGirdi.length);
for (const g of ioGirdi.slice(0, 8)) console.log("   girdi[" + g.id + "]:", g.text.replace(/\n/g, " "));
console.log("reply length   :", cevapMetni.length, "chars");
console.log("reply preview  :", cevapMetni.slice(0, 300).replace(/\n/g, " "));

// Does the subagent_type / specialist name appear in the input (Fix 141)?
const isimGorunur = ioGirdi.some((g) => /subagent_type|uzman|specialist/i.test(g.text));
console.log("specialist name in input:", isimGorunur ? "YES (Fix 141 works)" : "NO/not visible");

try { ws.close(); } catch {}
process.exit(0);
