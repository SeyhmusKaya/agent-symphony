// t05 — ZERO-TOKEN static checks (NO WS, spends no API tokens).
// (a) Fix 118: the models in <root>/.team/agents.json must be FULL slugs (claude-sonnet-4-6),
//     never bare "sonnet"/"opus"/"haiku".
// (b) CodeGraph bloat/VACUUM: open <root>/.architect/codegraph.db readonly;
//     print files/symbols/edges/docs/doc_chunks row counts + file MB.
//     assert: files < 5000 and MB < 60 (it used to be 107MB / ~22k files).
// (c) Fix 122: in the source of orchestrator/sdkHooks.ts + orchestrator/chief/runChiefAttempt.ts
//     the ACTIVE (non-comment) "[KOD ARAMA YASAK]" deny string AND the active
//     canUseTool deny assignment must be REMOVED. (A Fix-122 trace in comments is fine.)
//
// Take the project root from argv (default EmlakCopilot).
// Usage: node scripts/tests/t05_static_checks.mjs [projectRoot]
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", ".."); // scripts/tests -> repo root
const PROJ = process.argv[2] || "C:\\Users\\seyh\\Desktop\\projeler\\EmlakCopilot";

const sonuclar = []; // for each sub-check {ad, pass, not}
const push = (ad, pass, not) => sonuclar.push({ ad, pass, not });

// ---------- (a) agents.json model slug ----------
const BARE_ALIAS = /^(sonnet|opus|haiku)$/i;
try {
  const p = join(PROJ, ".team", "agents.json");
  if (!existsSync(p)) {
    push("a) agents.json", false, "not found: " + p);
  } else {
    const arr = JSON.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(arr)) {
      push("a) agents.json", false, "not an array");
    } else {
      const ciplaklar = arr
        .filter((x) => typeof x?.model === "string" && BARE_ALIAS.test(x.model.trim()))
        .map((x) => x.name + "=" + x.model);
      const modeller = arr.map((x) => x.model).join(", ");
      push("a) agents.json", ciplaklar.length === 0,
        ciplaklar.length === 0
          ? arr.length + " agents, all full slug [" + modeller + "]"
          : "BARE ALIAS: " + ciplaklar.join(", "));
    }
  }
} catch (e) {
  push("a) agents.json", false, "ERROR: " + e.message);
}

// ---------- (b) codegraph.db size + row counts ----------
try {
  const dbp = join(PROJ, ".architect", "codegraph.db");
  if (!existsSync(dbp)) {
    push("b) codegraph.db", false, "not found: " + dbp);
  } else {
    const mb = statSync(dbp).size / (1024 * 1024);
    const db = new Database(dbp, { readonly: true, fileMustExist: true });
    const say = (t) => {
      try { return db.prepare("SELECT COUNT(*) c FROM " + t).get().c; } catch { return "(none)"; }
    };
    const files = say("files");
    const symbols = say("symbols");
    const edges = say("edges");
    const docs = say("docs");
    const docChunks = say("doc_chunks");
    db.close();
    const filesOk = typeof files === "number" && files < 5000;
    const mbOk = mb < 60;
    push("b) codegraph.db", filesOk && mbOk,
      "size=" + mb.toFixed(1) + "MB files=" + files + " symbols=" + symbols
      + " edges=" + edges + " docs=" + docs + " doc_chunks=" + docChunks
      + (filesOk ? "" : " [FILES>=5000!]") + (mbOk ? "" : " [MB>=60!]"));
  }
} catch (e) {
  push("b) codegraph.db", false, "ERROR: " + e.message);
}

// ---------- (c) source: is the active deny REMOVED? ----------
// Drop comment lines (// ... and /* ... */ block bodies), then search the remaining ACTIVE code for deny.
// Simple approach: line-based // strip + roughly clean multi-line /* */.
function aktifKod(src) {
  // remove block comments
  let s = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // remove line // comments (// inside strings is low-risk; deny traces are not code)
  s = s.split("\n").map((ln) => {
    const i = ln.indexOf("//");
    return i >= 0 ? ln.slice(0, i) : ln;
  }).join("\n");
  return s;
}
function checkSource(rel, denyTests) {
  const p = join(REPO_ROOT, rel);
  if (!existsSync(p)) return { pass: false, not: rel + " not found" };
  const aktif = aktifKod(readFileSync(p, "utf8"));
  const hits = [];
  for (const { ad, rx } of denyTests) {
    if (rx.test(aktif)) hits.push(ad);
  }
  return {
    pass: hits.length === 0,
    not: hits.length === 0 ? "no active deny (clean)" : "IN ACTIVE CODE: " + hits.join(", "),
  };
}

const hooksRes = checkSource("orchestrator/sdkHooks.ts", [
  { ad: "[KOD ARAMA YASAK]", rx: /KOD ARAMA YASAK/ },
  { ad: "canUseTool deny", rx: /canUseTool/ },
]);
push("c1) sdkHooks.ts", hooksRes.pass, hooksRes.not);

const chiefRes = checkSource("orchestrator/chief/runChiefAttempt.ts", [
  { ad: "[KOD ARAMA YASAK]", rx: /KOD ARAMA YASAK/ },
  { ad: "canUseTool: assignment", rx: /canUseTool\s*:/ },
]);
push("c2) runChiefAttempt.ts", chiefRes.pass, chiefRes.not);

// ---------- summary ----------
console.log("\n===== T05 STATIC CHECKS (ZERO-TOKEN) =====");
console.log("project root : " + PROJ);
console.log("repo root    : " + REPO_ROOT);
console.log("");
let hepPass = true;
for (const r of sonuclar) {
  const tag = r.pass ? "PASS" : "FAIL";
  if (!r.pass) hepPass = false;
  console.log("[" + tag + "] " + r.ad + " : " + r.not);
}
console.log("");
console.log("RESULT: " + (hepPass ? "PASS — all static checks passed" : "FAIL — see the FAIL lines above"));
process.exit(0);
