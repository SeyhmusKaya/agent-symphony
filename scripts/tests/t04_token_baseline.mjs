// t04 — Fix 124 / token: COLD-START token baseline measurement.
// Send a SINGLE short command, print the last sef_token payload (liveIn, liveCacheRead,
// liveCacheCreate5m/1h, liveOut, liveUsd). NO hard-assert; for human inspection.
// Target context: it used to be ~22k cold; should be much less.
// NOTE: for the cleanest measurement, run the sef while cold via clear/new-session.
//
// TOKEN COST: YES (a single short turn). Run in a joint session.
// Usage: node scripts/tests/t04_token_baseline.mjs [port]
import { portFromArgv, connect, sendKomut, collect, bitir } from "./_ws.mjs";

const PORT = portFromArgv(4318);
const TIMEOUT = 90000;

const ws = await connect(PORT).catch((e) => { console.log("CONNECTION ERROR:", e.message); process.exit(0); });
const c = collect(ws);

console.log("WS opened (port " + PORT + ") -> SINGLE short command (cold-start measurement)...");
console.log("tip: for the cleanest cold-start, first clear/refresh the session.");
sendKomut(ws, "Hello. In a single sentence: what is this project for? Do not use tools, give a short answer.");

const sonuc = await c.waitForCevap(TIMEOUT);
const tok = c.tokens.length ? c.tokens[c.tokens.length - 1] : null;

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : "(none)");

let verdict;
if (!tok) {
  verdict = "UNCLEAR — sef_token never arrived (did the turn start? timeout?)";
} else {
  const ucret = typeof tok.liveUsd === "number" ? "$" + tok.liveUsd.toFixed(5) : "(none)";
  verdict = "MEASURED (no assert) — liveIn=" + fmt(tok.liveIn)
    + " cacheRead=" + fmt(tok.liveCacheRead) + " cost=" + ucret;
}

bitir(ws, "T04 TOKEN BASELINE (" + sonuc + ")", [
  "liveIn (new input tokens) : " + (tok ? fmt(tok.liveIn) : "(none)"),
  "liveCacheRead : " + (tok ? fmt(tok.liveCacheRead) : "(none)"),
  "liveCacheCreate5m : " + (tok ? fmt(tok.liveCacheCreate5m) : "(none)"),
  "liveCacheCreate1h : " + (tok ? fmt(tok.liveCacheCreate1h) : "(none)"),
  "liveOut : " + (tok ? fmt(tok.liveOut) : "(none)"),
  "liveUsd : " + (tok && typeof tok.liveUsd === "number" ? "$" + tok.liveUsd.toFixed(5) : "(none)"),
  "sessionId : " + (tok ? (tok.sessionId ?? "(none)") : "(none)"),
  "turn completed : " + c.completed,
  "--- comparison: old cold was ~22k liveIn, now expected much less ---",
], verdict);
