import { connect, collect, sendKomut, sleep } from "./_ws.mjs";
const ws = await connect(4321, 8000);
const c = collect(ws);
sendKomut(ws, "Read the file app/Models/User.php FULLY (do not use offset/limit) and tell me how many lines it has. Do not use any other tool, only Read.");
const r = await c.waitForCevap(120000);
console.log("turn:", r, "reply:", c.deltas.join("").slice(0,150).replace(/\n/g," "));
try{ws.close()}catch{}; process.exit(0);
