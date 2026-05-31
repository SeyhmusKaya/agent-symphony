import { connect, collect, sendKomut, sleep } from "./_ws.mjs";
const ws = await connect(4323, 8000);
const c = collect(ws);
const finalById = new Map();
c.onAny((m) => {
  if (m.kind === "sef_aktivite_io" && m.ioKind === "girdi" && m.id) {
    const prev = finalById.get(m.id) || "";
    if ((m.text || "").length >= prev.length) finalById.set(m.id, m.text || "");
  }
});
sendKomut(ws, "Ask the yapi-uzmani specialist: what is this project's main technology? One sentence.");
await c.waitForCevap(150000);
await sleep(1500);
console.log("=== FINAL Agent inputs ===");
for (const [id, txt] of finalById) {
  if (/subagent_type|description|prompt/.test(txt)) {
    console.log("id=" + id);
    console.log("  full:", txt.slice(0, 400).replace(/\n/g, " "));
    const m = txt.match(/"subagent_type"\s*:\s*"([^"]*)"/);
    console.log("  subagent_type =>", m ? m[1] : "NONE");
  }
}
console.log("sef_cevap count:", c.raw.filter((x) => x.kind === "sef_cevap").length);
try { ws.close(); } catch {}
process.exit(0);
