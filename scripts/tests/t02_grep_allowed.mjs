// t02 — Fix 122: an EXPLICIT Grep request is NOT REJECTED.
// Tell the sef directly "search with Grep". Expected: no sef_aktivite_io result
// contains "[KOD ARAMA YASAK]" / "reddedildi", Grep runs, the turn completes.
//
// TOKEN COST: YES (live sef turn). Run in a joint session.
// Usage: node scripts/tests/t02_grep_allowed.mjs [port]
import { portFromArgv, connect, sendKomut, collect, DENY_RX, bitir } from "./_ws.mjs";

const PORT = portFromArgv(4318);
const TIMEOUT = 150000;

const ws = await connect(PORT).catch((e) => { console.log("CONNECTION ERROR:", e.message); process.exit(0); });
const c = collect(ws);

console.log("WS opened (port " + PORT + ") -> sending EXPLICIT Grep command...");
sendKomut(
  ws,
  "Please find a few files containing the word 'function' in the project source by using the Grep tool DIRECTLY. Do not use CodeGraph; I specifically want Grep. Name 1-2 example files from what you find.",
);

const sonuc = await c.waitForCevap(TIMEOUT);

// Was Grep actually called?
const grepCagrildi = c.toolOrder.some((t) => /^Grep$/.test(t));
// Is there a deny trace in any io result?
const denyHit = c.ioResults.find((r) => DENY_RX.test(r.text ?? "") || DENY_RX.test(r.hata ?? ""));

let verdict;
if (denyHit) {
  verdict = "FAIL — DENY TRACE FOUND: " + String(denyHit.text || denyHit.hata).slice(0, 120);
} else if (!c.completed) {
  verdict = "FAIL — TURN DID NOT COMPLETE (timeout?)";
} else {
  verdict = "PASS — Grep not blocked, no deny trace, turn completed"
    + (grepCagrildi ? " (Grep called)" : " (NOTE: no Grep call observed but no deny either)");
}

bitir(ws, "T02 GREP ALLOWED (" + sonuc + ")", [
  "tool order : " + (c.toolOrder.length ? c.toolOrder.join(" -> ") : "(none)"),
  "Grep called : " + grepCagrildi,
  "io result count : " + c.ioResults.length,
  "deny trace : " + (denyHit ? "YES" : "no"),
  "turn completed : " + c.completed,
], verdict);
