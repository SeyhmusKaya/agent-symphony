// t01 — Fix 122 CRITICAL: on a neutral code-search task, does the sef use codegraph FIRST?
// Give a code-search task WITHOUT naming a tool. Expected: the first search tool is
// mcp__architect__code_search / code_* / search_docs (codegraph), NOT Grep/Bash.
// The hard-deny was removed; codegraph is preferred ONLY via the soft system-prompt —
// this test measures whether that soft guidance works.
//
// TOKEN COST: YES (live sef turn). Run in a joint session.
// Usage: node scripts/tests/t01_codegraph_usage.mjs [port]
import { portFromArgv, connect, sendKomut, collect, CODEGRAPH_RX, RAW_SEARCH_RX, bitir } from "./_ws.mjs";

const PORT = portFromArgv(4318);
const TIMEOUT = 150000;

const ws = await connect(PORT).catch((e) => { console.log("CONNECTION ERROR:", e.message); process.exit(0); });
const c = collect(ws);

console.log("WS opened (port " + PORT + ") -> sending neutral code-search command...");
sendKomut(
  ws,
  "In which file is the MAIN function or class related to user login/authentication (login/auth/signin) defined? Find it and say it in a single sentence. I am NOT specifying which method to search with; pick the most suitable and economical way yourself.",
);

const sonuc = await c.waitForCevap(TIMEOUT);

const order = c.toolOrder;
const cgFirst = order.findIndex((t) => CODEGRAPH_RX.test(t));
const rawFirst = order.findIndex((t) => RAW_SEARCH_RX.test(t));

let verdict;
if (cgFirst === -1 && rawFirst === -1) {
  verdict = "NO SEARCH (answered from knowledge) — unclear, clarify the task";
} else if (cgFirst !== -1 && (rawFirst === -1 || cgFirst < rawFirst)) {
  verdict = "PASS — CODEGRAPH USED FIRST";
} else {
  verdict = "FAIL — GREP/BASH FIRST (codegraph skipped, soft prompt insufficient)";
}

bitir(ws, "T01 CODEGRAPH USAGE (" + sonuc + ")", [
  "tool order : " + (order.length ? order.join(" -> ") : "(no search tool)"),
  "first codegraph idx : " + cgFirst,
  "first Grep/Bash/Glob idx : " + rawFirst,
  "turn completed : " + c.completed,
], verdict);
