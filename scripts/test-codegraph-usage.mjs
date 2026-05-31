// NEUTRAL codegraph usage test: give the sef a code-search task WITHOUT naming a tool.
// Is the first search tool it uses code_search/code_* (codegraph) or Grep/Bash?
// After Fix 122 there is no hard-deny -> codegraph is preferred ONLY via a soft prompt.
import WebSocket from "ws";
const PORT = process.argv[2] || "4318";
const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
const order = [];
let completed = false;
const CG = /code_search|code_node|code_callers|code_callees|code_files|code_impact|code_imports|search_docs|get_doc_outline|list_docs|code_stats/i;
const RAW = /^(Grep|Bash|Glob)$/;

function finish(reason) {
  const cgFirst = order.findIndex((t) => CG.test(t));
  const rawFirst = order.findIndex((t) => RAW.test(t));
  console.log("\n===== CODEGRAPH USAGE TEST (" + reason + ") =====");
  console.log("tool order:", order.length ? order.join(" -> ") : "(no search tool)");
  console.log("first codegraph tool idx:", cgFirst);
  console.log("first Grep/Bash/Glob idx:", rawFirst);
  let verdict;
  if (cgFirst === -1 && rawFirst === -1) verdict = "NO SEARCH (answered from knowledge)";
  else if (cgFirst !== -1 && (rawFirst === -1 || cgFirst < rawFirst)) verdict = "CODEGRAPH USED FIRST (GOOD)";
  else verdict = "GREP/BASH FIRST (codegraph skipped - soft prompt insufficient)";
  console.log("RESULT:", verdict);
  console.log("completed:", completed);
  try { ws.close(); } catch {}
  process.exit(0);
}
ws.on("open", () => {
  console.log("WS opened (port " + PORT + ") -> neutral code-search command");
  ws.send(JSON.stringify({
    kind: "komut",
    text: "In which file is the MAIN function or class related to user login/authentication (login / auth / signin) defined? Find it and say it in a single sentence. I am not specifying which method to search with; pick the most suitable/economical way.",
  }));
});
ws.on("message", (buf) => {
  let m; try { m = JSON.parse(buf.toString()); } catch { return; }
  if (m.kind === "sef_aktivite" && m.durum === "calisiyor" && m.ad) order.push(m.ad);
  if (m.kind === "sef_cevap") { completed = true; setTimeout(() => finish("sef_cevap"), 1500); }
});
ws.on("error", (e) => { console.log("WS ERROR:", e.message); process.exit(1); });
setTimeout(() => finish("timeout 120s"), 120000);
