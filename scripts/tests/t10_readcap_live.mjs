import { connect, collect, sendKomut } from "./_ws.mjs";
const PORT = Number(process.argv[2]) || 4323;
const ws = await connect(PORT, 8000);
const c = collect(ws);
sendKomut(ws, "Read the LARGEST .php file in the app/Filament/Resources directory fully WITHOUT offset/limit, just tell me how many lines it has. A single Read.");
const r = await c.waitForCevap(120000);
console.log("turn:", r, "reply:", c.deltas.join("").slice(0,120).replace(/\n/g," "));
try{ws.close()}catch{}; process.exit(0);
