// Notları tek tek Mimar'a yaptırır. Genel (kapsam=genel) notları alır,
// her birine yapildi=false ise Mimar'a "bu notu yap" der, sonucu kaydeder.
import WebSocket from "ws";
import { readFileSync, writeFileSync } from "node:fs";

const PORT = 4316; // Mimar
const NOTES_PATH = String.raw`C:\Users\seyh\AppData\Roaming\com.seyh.architect\notes.json`;
const RESULT_PATH = `note-processing-result-${Date.now()}.json`;

const notes = JSON.parse(readFileSync(NOTES_PATH, "utf8"));
const targets = notes.filter((n) => n.kapsam === "genel" && !n.yapildi);
console.log(`Genel acik not: ${targets.length}`);

const results = [];

async function turn(noteId, content) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const start = Date.now();
    let cost = null, tools = 0, reply = "";
    let settled = false;
    let timer = null;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      ws.close();
      resolve(r);
    };
    ws.on("open", () =>
      ws.send(JSON.stringify({
        kind: "komut",
        text: `Notlardan birinde yapilmasi gereken bir is var, id=${noteId}. Icerik: ${content}. Yapabiliyorsan yap, dogrula, sonra note_update(id="${noteId}", yapildi=true) ile isaretle. Yapamiyorsan veya kullanici onayi gerekliyse aciklayarak yapildi=false birak ve neden oldugunu yaz.`,
      }))
    );
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.kind === "sef_aktivite") tools++;
      if (m.kind === "sef_cevap") {
        reply = m.text || "";
        if (m.cost) cost = m.cost;
      }
      if (m.kind === "ajan_soru") {
        // Otomatik ilk secenek
        const cevap = (m.secenekler && m.secenekler[0]) || "evet";
        ws.send(JSON.stringify({ kind: "kullanici_cevap", askId: m.askId, cevap }));
      }
      if (m.kind === "sef_tamamen_idle") {
        const dur = Date.now() - start;
        const r = { noteId, content: content.slice(0, 80), dur, tools, cost, reply: reply.slice(0, 500) };
        results.push(r);
        console.log(`[${noteId.slice(0, 8)}] dur=${dur}ms tools=${tools} cost=$${cost?.usd?.toFixed(4) ?? "?"}`);
        finish(r);
      }
    });
    ws.on("error", (e) => finish({ noteId, error: e.message }));
    timer = setTimeout(() => finish({ noteId, error: "timeout" }), 600000); // 10dk
  });
}

(async () => {
  for (let i = 0; i < targets.length; i++) {
    const n = targets[i];
    console.log(`\n[${i + 1}/${targets.length}] ${n.baslik}`);
    await turn(n.id, n.icerik);
    // Notes file'i tekrar oku, yapildi check + ara kayit
    writeFileSync(RESULT_PATH, JSON.stringify(results, null, 2));
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("\n--- BITTI ---");
  const totalUsd = results.reduce((a, r) => a + (r.cost?.usd || 0), 0);
  console.log(`turns=${results.length} totalUsd=$${totalUsd.toFixed(4)}`);
  console.log(`saved: ${RESULT_PATH}`);
  process.exit(0);
})();
