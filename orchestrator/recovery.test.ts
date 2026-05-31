// Cokme kurtarma testi — `tsx orchestrator/recovery.test.ts` ile calistir.
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CommandQueue } from "./queue.js";

let failed = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? "GECTI" : "KALDI"}  ${label}`);
  if (!cond) failed++;
}

const dir = mkdtempSync(join(tmpdir(), "arc-recovery-"));
const file = join(dir, "queue.json");

try {
  // 1. Komut ekle: biri "isleniyor" (yarim tur), biri non-autonomous "bekliyor"
  //    (hayalet SIRADA is), biri autonomous "bekliyor" (korunmali).
  const q1 = new CommandQueue(file);
  const a = q1.enqueue("birinci komut");
  const b = q1.enqueue("ikinci komut");
  const c = q1.enqueue("otonom komut", { autonomous: true });
  q1.flushSync(); // debounced save'i diske zorla — sync read icin.

  const raw = JSON.parse(readFileSync(file, "utf8")) as { id: string; status: string }[];
  raw[0].status = "isleniyor";
  writeFileSync(file, JSON.stringify(raw));

  // 2. Yeni CommandQueue ile diskten yukle (yeniden baslatma).
  const q2 = new CommandQueue(file);
  const interrupted = q2.recover();

  check("yarim + hayalet komut tespit edildi", interrupted.length === 2);
  check("yarim komut iptal listesinde", interrupted.some((x) => x.id === a.id));
  check("hayalet bekleyen iptal listesinde", interrupted.some((x) => x.id === b.id));
  check("otonom komut iptal edilmedi", !interrupted.some((x) => x.id === c.id));

  const after = q2.list();
  check("yarim komut 'kesildi' isaretlendi", after.find((x) => x.id === a.id)?.status === "kesildi");
  check("hayalet bekleyen 'kesildi' isaretlendi", after.find((x) => x.id === b.id)?.status === "kesildi");
  check("otonom komut 'bekliyor' korundu", after.find((x) => x.id === c.id)?.status === "bekliyor");

  // 3. Diske yazildi mi.
  const persisted = JSON.parse(readFileSync(file, "utf8")) as { id: string; status: string }[];
  check("kesildi durumu diske yazildi", persisted.find((x) => x.id === a.id)?.status === "kesildi");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed} test KALDI.`);
  process.exit(1);
}
console.log("\nTum cokme kurtarma testleri GECTI.");
