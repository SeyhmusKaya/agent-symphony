// Fix 92 test: run + query the docs index.
// Does not touch any active orchestrator — parallel open on the sqlite WAL.
import { CodeGraphDB } from "../dist/orchestrator/codegraph/db.js";
import { DocIndexer } from "../dist/orchestrator/codegraph/docIndexer.js";
import { resolve } from "node:path";

const targets = [
  { root: "C:/Users/seyh/Desktop/projeler/Architect", db: "C:/Users/seyh/Desktop/projeler/Architect/.architect/codegraph.db" },
];

for (const t of targets) {
  console.log(`\n=== ${t.root} ===`);
  const db = new CodeGraphDB(t.db);

  const before = db.stats();
  console.log(`pre  docs=${before.docs ?? "?"} chunks=${before.docChunks ?? "?"}`);

  const idx = new DocIndexer(t.root, db);
  const start = Date.now();
  const res = await idx.fullIndex({});
  console.log(`scan docs=${res.docs} chunks=${res.chunks} ${res.durationMs}ms`);

  const after = db.stats();
  console.log(`post docs=${after.docs} chunks=${after.docChunks} types=${JSON.stringify(after.docTypes)}`);

  // Search smoke tests
  const queries = [
    { q: "compactSummary", types: undefined },
    { q: "rebuild_ui", types: undefined },
    { q: "Fix 92", types: ["md"] },
    { q: "tree-sitter", types: ["json"] },
    { q: "ProviderRegistry", types: ["md"] },
  ];
  for (const { q, types } of queries) {
    const rows = db.searchDocs(q, { docTypes: types, limit: 5 });
    console.log(`  search "${q}" types=${types ?? "*"} -> ${rows.length} hit`);
    for (const r of rows.slice(0, 2)) {
      console.log(`    ${r.path}:${r.line_start} (${r.doc_type}) "${(r.title ?? "").slice(0, 40)}" :: ${r.snippet.slice(0, 80).replace(/\s+/g, " ")}`);
    }
  }

  // Outline test
  const readmes = db.docsList({ glob: "README.md", limit: 5 });
  console.log(`\noutline tests:`);
  for (const r of readmes.slice(0, 1)) {
    const outline = db.docOutline(r.path);
    console.log(`  ${r.path}: ${outline.length} chunk(s)`);
    for (const c of outline.slice(0, 5)) {
      console.log(`    L${c.line_start}-${c.line_end} ${c.chunk_kind} lvl=${c.level} "${(c.title ?? "").slice(0, 50)}"`);
    }
  }

  // package.json outline
  const pkg = db.docsList({ glob: "package.json", limit: 1 });
  for (const r of pkg) {
    const outline = db.docOutline(r.path);
    console.log(`\n  ${r.path}: ${outline.length} key(s)`);
    for (const c of outline.slice(0, 10)) {
      console.log(`    L${c.line_start} ${c.chunk_kind} "${c.title}" (body=${(c.body ?? "").length}ch)`);
    }
  }

  db.close();
}

console.log("\ndone");
