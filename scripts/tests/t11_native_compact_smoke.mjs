// Fix 148 smoke: with NATIVE_COMPACT on, does a normal sef turn NOT BREAK?
// settings:{autoCompactEnabled,autoCompactWindow} added -> an SDK query must
// complete without error. A single short turn (cheap). The compaction TRIGGER is
// not tested (170k context is expensive) — just a regression check.
import WebSocket from "ws";
import { connect, sendKomut, collect } from "./_ws.mjs";

const port = Number(process.argv[2] || 4325); // default: google yorum (small)
const ws = await connect(port, 8000);
const c = collect(ws);
let cevapMetin = "";
c.onAny((m) => { if (m.kind === "sef_cevap") cevapMetin = m.metin ?? m.text ?? ""; });
sendKomut(ws, "Answer in a single word: are you ready? Just write 'yes'.");
const r = await c.waitForCevap(90000);
const tokenSon = c.tokens[c.tokens.length - 1];
console.log("\n===== t11 NATIVE_COMPACT smoke =====");
console.log("waitForCevap:", r);
console.log("reply (first 120):", (cevapMetin || c.deltas.join("")).slice(0, 120));
console.log("last token:", tokenSon ? JSON.stringify({ in: tokenSon.input, out: tokenSon.output, ctx: tokenSon.context }) : "none");
const ok = r === "cevap" && (cevapMetin || c.deltas.length) ;
console.log("VERDICT:", ok ? "PASS (turn did not break)" : "FAIL");
ws.close();
process.exit(0);
