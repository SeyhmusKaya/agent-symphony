// Fix 107: memory cross-project isolation.
// TaggedMemory.search with a proje:<name> filter returns only that project's
// notes. The memoryTools tool auto-injects the active project tag when no filter
// is given (verified by code review); here the infrastructure is tested.

import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "arc-mem-test-"));
const { TaggedMemory, SharedMemory } = await import("../../dist/orchestrator/memory.js");

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else { console.log(`FAIL  ${label}`); fail++; }
}

const tagged = new TaggedMemory(join(tmp, "tagged.json"));
await tagged.remember("Volpora checkout page to be rewritten", ["proje:Volpora"]);
await tagged.remember("google_yorum scraper proxy rotation", ["proje:google_yorum"]);
await tagged.remember("Volpora payment integration iyzico", ["proje:Volpora"]);
await tagged.remember("User works in the morning", ["tur:profil"]);

// Filtered search: Volpora only.
const volp = await tagged.search("page payment", ["proje:Volpora"], 10);
check("Volpora filter = 2 records", volp.length === 2);
check("Volpora filter does not contain google_yorum",
  !volp.some((e) => e.tags.includes("proje:google_yorum")));

// Filtered search: google_yorum only.
const gy = await tagged.search("scraper proxy", ["proje:google_yorum"], 10);
check("google_yorum filter >= 1 record", gy.length >= 1);
check("google_yorum filter does not contain Volpora",
  !gy.some((e) => e.tags.includes("proje:Volpora")));

// Unfiltered search (Mimar path): all projects come back.
const all = await tagged.search("Volpora google scraper page", [], 10);
check("unfiltered search returns multiple projects", all.length >= 2);

// SharedMemory project field check.
const shared = new SharedMemory(join(tmp, "shared.json"));
shared.set("vol_key", "vol_value", "C:/projeler/Volpora");
shared.set("gy_key", "gy_value", "C:/projeler/google_yorum");
const list = shared.list();
check("SharedMemory 2 records", list.length === 2);
const volEntry = shared.get("vol_key");
check("SharedMemory get project field correct", volEntry?.project === "C:/projeler/Volpora");

try { rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
