// t03 — Fix 120: does "durdur" ACTUALLY stop it?
// Start a multi-step command. ~6s after the first activity, send
// "kontrol durdur". For the next 7s NO new sef_parcali delta AND
// no new sef_aktivite with "calisiyor" status should arrive (~0).
//
// TOKEN COST: YES (live sef turn, shortened by stopping). Run in a joint session.
// Usage: node scripts/tests/t03_stop.mjs [port]
import { portFromArgv, connect, sendKomut, sendKontrol, collect, sleep, bitir } from "./_ws.mjs";

const PORT = portFromArgv(4318);
const ILK_AKTIVITE_BEKLE = 25000; // ceiling until the first activity arrives
const DURDURMADAN_ONCE = 6000;    // let it run after the first activity
const SESSIZLIK_PENCERESI = 7000; // measurement window after durdur

const ws = await connect(PORT).catch((e) => { console.log("CONNECTION ERROR:", e.message); process.exit(0); });
const c = collect(ws);

// capture the first activity
let ilkAktiviteZamani = 0;
c.onTool((m) => { if (!ilkAktiviteZamani && m.durum === "calisiyor") ilkAktiviteZamani = Date.now(); });

console.log("WS opened (port " + PORT + ") -> sending multi-step command...");
sendKomut(
  ws,
  "Do the following IN ORDER, each in a separate step: (1) list the files in the project root directory, (2) find the 3 largest source files, (3) summarize the first 20 lines of each, (4) produce a dependency map. Proceed step by step, do not rush.",
);

// wait for the first activity (ceiling ILK_AKTIVITE_BEKLE)
const t0 = Date.now();
while (!ilkAktiviteZamani && Date.now() - t0 < ILK_AKTIVITE_BEKLE) await sleep(300);

if (!ilkAktiviteZamani) {
  bitir(ws, "T03 STOP", [
    "first activity : DID NOT ARRIVE (within " + ILK_AKTIVITE_BEKLE + "ms)",
  ], "UNCLEAR — command never started (sef busy/idle?), try again");
}

console.log("first activity arrived, letting it run for " + DURDURMADAN_ONCE + "ms...");
await sleep(DURDURMADAN_ONCE);

console.log("sending kontrol DURDUR, the next " + SESSIZLIK_PENCERESI + "ms will be measured...");
sendKontrol(ws, "durdur");

const sessizlik = await c.watchSilence(SESSIZLIK_PENCERESI);

let verdict;
if (sessizlik.deltaSayisi === 0 && sessizlik.aktiviteSayisi === 0) {
  verdict = "PASS — 0 delta / 0 new activity after durdur";
} else {
  verdict = "FAIL — after durdur delta=" + sessizlik.deltaSayisi
    + " new-activity=" + sessizlik.aktiviteSayisi + " (did not stop)";
}

bitir(ws, "T03 STOP (Fix 120)", [
  "total delta before stopping : " + (c.deltas.length - sessizlik.deltaSayisi),
  "total activity before stopping : " + (c.toolOrder.length - sessizlik.aktiviteSayisi),
  "window delta (after durdur) : " + sessizlik.deltaSayisi,
  "window new-activity (after durdur) : " + sessizlik.aktiviteSayisi,
], verdict);
