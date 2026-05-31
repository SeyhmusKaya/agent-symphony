// One-off: send a bug-analysis kickoff command to the EmlakCopilot sef (port 4318).
// Exit after a "komut_alindi"/"sef_tur_basladi" ack or a 12s timeout — do not
// ingest the stream (it is watched in the UI).
import WebSocket from "ws";

const PORT = 4318;
const text = [
  "Do a DETAILED pre-production bug + gap analysis. Only THIS project (EmlakCopilot).",
  "",
  "1) Start code discovery with CodeGraph (code_stats, code_files, code_search) — not Bash ls/grep.",
  "2) Review unfinished work belonging to your own project (memory_search/note_list — this project only).",
  "3) Report critical bugs in priority order (P0/P1/P2) with file:line: security, data loss, crash, flow-breaking > UX.",
  "4) BEFORE starting any large change, give the report and ask which one to start with.",
  "",
  "Note: model opus-4-8, no silent model switching. Short, clear, prioritized list.",
].join("\n");

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
let done = false;
const finish = (msg) => {
  if (done) return;
  done = true;
  console.log(msg);
  try { ws.close(); } catch {}
  process.exit(0);
};

const timer = setTimeout(() => finish("TIMEOUT: command sent but no ack received (it may still have been processed)."), 12000);

ws.on("open", () => {
  ws.send(JSON.stringify({ kind: "komut", text }));
  console.log("command sent -> port " + PORT);
});
ws.on("message", (raw) => {
  let m;
  try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.kind === "komut_alindi" || m.kind === "sef_tur_basladi" ||
      (m.kind === "event" && m.event && /tur_basladi|isleniyor/.test(m.event.type ?? ""))) {
    clearTimeout(timer);
    finish("ACK: sef received/processing the command (kind=" + m.kind + "). Watch in the EmlakCopilot chat in the UI.");
  }
});
ws.on("error", (e) => finish("WS ERROR: " + e.message));
