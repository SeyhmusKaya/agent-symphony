#!/usr/bin/env node
// Copy schema.sql + queries/*.scm into dist/orchestrator/codegraph/
import { mkdirSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "orchestrator", "codegraph");
const dst = join(root, "dist", "orchestrator", "codegraph");
const dstQueries = join(dst, "queries");

if (!existsSync(src)) {
  console.error("[codegraph-assets] source missing:", src);
  process.exit(0);
}

mkdirSync(dst, { recursive: true });
mkdirSync(dstQueries, { recursive: true });

const schemaSrc = join(src, "schema.sql");
if (existsSync(schemaSrc)) {
  copyFileSync(schemaSrc, join(dst, "schema.sql"));
}

const qSrc = join(src, "queries");
if (existsSync(qSrc)) {
  for (const f of readdirSync(qSrc)) {
    if (f.endsWith(".scm")) {
      copyFileSync(join(qSrc, f), join(dstQueries, f));
    }
  }
}

console.log("[codegraph-assets] copied schema + queries to dist");
