import { connect, collect, sendKomut } from "./_ws.mjs";
const ws = await connect(4323, 8000);
const c = collect(ws);
sendKomut(ws, "Hello, one sentence: which project's sef are you?");
const r = await c.waitForCevap(60000);
console.log("turn:", r, "| reply:", c.deltas.join("").slice(0,120).replace(/\n/g," "));
console.log("any error:", c.ioResults.some(x=>x.hata) ? "YES" : "no");
try{ws.close()}catch{}; process.exit(0);
