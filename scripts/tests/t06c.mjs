// t06c — test #3: being able to talk to the sef while a specialist works (async delegation).
// 1) send a long specialist task (30s+ -> delege_arkaplan expected)
// 2) when the sef gives the first reply (ack), send a 2nd message
// 3) measure whether the sef replies to the 2nd message (not blocked)
import { connect, collect, sendKomut, sleep } from "./_ws.mjs";
const ws = await connect(4323, 8000);
const c = collect(ws);
const tools = [];
let cevapSayisi = 0;
c.onAny((m) => {
  if (m.kind === "sef_aktivite" && m.ad) tools.push(m.ad);
  if (m.kind === "sef_cevap") cevapSayisi++;
});
// cevapSayisi-based waiter (does not depend on the completed flag).
function waitCevapN(hedef, ms) {
  return new Promise((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cevapSayisi >= hedef) { clearInterval(iv); res("cevap"); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); res("timeout"); }
    }, 250);
  });
}

console.log("[t06c] sending long specialist task...");
sendKomut(ws, "Give the yapi-uzmani specialist a detailed task: analyze the whole project file structure, main modules and architecture, and prepare a comprehensive report. This is a long-running job.");

const r1 = await waitCevapN(1, 120000);
const cevap1 = c.deltas.join("");
console.log("first turn:", r1, "| reply length:", cevap1.length);
const delegeArkaplan = tools.filter((t) => /arkaplan/i.test(t)).length;
const agentBlocking = tools.filter((t) => /^Agent$/.test(t)).length;
console.log("delege_arkaplan calls:", delegeArkaplan, "| blocking Agent:", agentBlocking);

// 2nd message — while the bg job runs in the background
const deltaBefore = c.deltas.length;
console.log("[t06c] sending 2nd message (bg job in background)...");
sendKomut(ws, "By the way, quickly tell me: how many specialists do you have?");
const r2 = await waitCevapN(2, 120000);
const yeniDelta = c.deltas.slice(deltaBefore).join("");
console.log("2nd turn:", r2, "| new reply length:", yeniDelta.length);
console.log("2nd reply preview:", yeniDelta.slice(0, 200).replace(/\n/g, " "));

console.log("\n=== VERDICT ===");
console.log(delegeArkaplan > 0 ? "ASYNC: delege_arkaplan used [PASS]" : "ASYNC: blocking Agent used (may be a short-job preference)");
console.log(yeniDelta.length > 0 ? "#3: sef REPLIED to the 2nd message [PASS - not blocked]" : "#3: NO reply from sef to the 2nd message [FAIL - blocked]");
console.log("total sef_cevap:", c.raw.filter((x) => x.kind === "sef_cevap").length);
try { ws.close(); } catch {}
process.exit(0);
