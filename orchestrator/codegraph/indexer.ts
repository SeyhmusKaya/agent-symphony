import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { relative, resolve, posix, sep } from "node:path";
import fg from "fast-glob";
import { CodeGraphDB } from "./db.js";
import { detectLanguage, parseSource, type Language } from "./parser.js";

// Fix 46: added vendor + framework caches. In the Volpora project phpunit/vendor
// scanned 46k+ files, codegraph 391s CPU + 326k symbols → wasted ram+disk.
// Vendor folders are not user code, no need to index them.
const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/vendor/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/.next/**",
  "**/target/**",
  "**/.architect/**",
  "**/.architect-storage/**",
  "**/coverage/**",
  "**/out/**",
  "**/.svelte-kit/**",
  "**/src-tauri/target/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/storage/framework/**",
  "**/storage/logs/**",
  "**/bootstrap/cache/**",
  "**/public/build/**",
  "**/public/hot/**",
  "**/.pytest_cache/**",
  "**/.mypy_cache/**",
  "**/.ruff_cache/**",
  "**/migrations/**",
  // Test framework caches that vendor sometimes brings without /vendor/ prefix
  "**/phpunit/**",
  "**/PHPUnit/**",
];

const SUPPORTED_GLOBS = [
  "**/*.ts", "**/*.mts", "**/*.cts", "**/*.tsx",
  "**/*.js", "**/*.mjs", "**/*.cjs", "**/*.jsx",
  "**/*.php",
  "**/*.cs",
  "**/*.razor", "**/*.cshtml",
  "**/*.py",
];

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function hashOf(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

export interface IndexProgress {
  total: number;
  processed: number;
  current?: string;
  skipped?: number;
}

export type ProgressCb = (p: IndexProgress) => void;

export interface IndexOptions {
  ignore?: string[];
  maxFileBytes?: number; // skip larger than this
  onProgress?: ProgressCb;
}

export class Indexer {
  constructor(
    public readonly rootDir: string,
    public readonly db: CodeGraphDB
  ) {}

  async fullIndex(opts: IndexOptions = {}): Promise<{ files: number; symbols: number; edges: number; durationMs: number }> {
    const start = Date.now();
    const ignore = [...DEFAULT_IGNORE, ...(opts.ignore ?? [])];
    const maxBytes = opts.maxFileBytes ?? 1_000_000; // 1 MB

    // Fix CODEGRAPH-BLOAT: full index = clean start. Prevents stale rows of
    // files that dropped out of the scan (added to ignore / deleted) from
    // accumulating (e.g. node_modules/vendor junk indexed before Fix 46).
    // Otherwise the DB kept growing forever (22k files, really ~1.2k).
    this.db.clearCode();

    const paths = await fg(SUPPORTED_GLOBS, {
      cwd: this.rootDir,
      ignore,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      dot: false,
    });

    let processed = 0;
    let skipped = 0;
    const total = paths.length;

    // Sequential — better-sqlite3 transactions cannot wrap async work.
    // Each indexFile is a small write set; SQLite handles N writes/sec easily.
    for (const p of paths) {
      const ok = await this.indexFile(p, maxBytes);
      processed++;
      if (!ok) skipped++;
      opts.onProgress?.({ total, processed, current: toPosix(relative(this.rootDir, p)), skipped });
    }

    // 2nd pass: resolve unresolved edges
    this.resolveUnresolved();

    const stats = this.db.stats();
    this.db.setMeta("last_full_index", String(Date.now()));
    this.db.setMeta("total_files", String(stats.files));
    this.db.setMeta("total_symbols", String(stats.symbols));
    this.db.setMeta("total_edges", String(stats.edges));

    return {
      files: stats.files,
      symbols: stats.symbols,
      edges: stats.edges,
      durationMs: Date.now() - start,
    };
  }

  async indexFile(absPath: string, maxBytes = 1_000_000): Promise<boolean> {
    const lang = detectLanguage(absPath);
    if (!lang) return false;
    let st;
    try {
      st = await stat(absPath);
    } catch {
      return false;
    }
    if (!st.isFile()) return false;
    if (st.size > maxBytes) return false;

    let src: string;
    try {
      src = await readFile(absPath, "utf8");
    } catch {
      return false;
    }

    const relPath = toPosix(relative(this.rootDir, absPath));
    const fileHash = hashOf(src);

    const parsed = await parseSource(absPath, src, lang);
    if (!parsed) return false;

    // Sync transaction — all DB work for this file in one atomic batch.
    return this.db.transaction(() => this.writeParsed(absPath, src, parsed, st, fileHash, lang, relPath));
  }

  private writeParsed(
    absPath: string,
    src: string,
    parsed: NonNullable<Awaited<ReturnType<typeof parseSource>>>,
    st: { size: number; mtimeMs: number },
    fileHash: string,
    lang: ReturnType<typeof detectLanguage> & string,
    relPath: string,
  ): boolean {
    const fileId = this.db.upsertFile({
      path: relPath,
      language: lang,
      size: st.size,
      mtime: Math.floor(st.mtimeMs),
      hash: fileHash,
      indexed_at: Date.now(),
    });

    // Insert symbols, keep map name -> id for in-file edges
    const inFileSymbols = new Map<string, number>();
    for (const s of parsed.symbols) {
      const qname = `${relPath}::${s.name}`;
      const id = this.db.insertSymbol({
        file_id: fileId,
        name: s.name,
        qualified_name: qname,
        kind: s.kind,
        start_line: s.startLine,
        end_line: s.endLine,
        start_col: s.startCol,
        end_col: s.endCol,
        signature: s.signature ?? null,
        doc: null,
        is_exported: s.isExported ? 1 : 0,
      });
      inFileSymbols.set(s.name, id);
    }

    // First "container" symbol for calls: pick the nearest enclosing fn by line
    const orderedSyms = parsed.symbols
      .map((s) => ({ ...s }))
      .sort((a, b) => a.startLine - b.startLine);

    const findContainerId = (line: number): number | null => {
      // Innermost: latest start <= line and end >= line
      let bestId: number | null = null;
      for (const s of orderedSyms) {
        if (s.startLine <= line && s.endLine >= line) {
          const id = inFileSymbols.get(s.name);
          if (id) bestId = id;
        }
      }
      return bestId;
    };

    // Calls -> edges (unresolved by name; resolver pass fills)
    for (const c of parsed.calls) {
      const srcId = findContainerId(c.line) ?? inFileSymbols.values().next().value ?? null;
      if (srcId == null) continue;
      // Try in-file resolution first
      const inFile = inFileSymbols.get(c.callee);
      this.db.insertEdge({
        src_symbol_id: srcId,
        dst_symbol_id: inFile ?? null,
        dst_unresolved: inFile ? null : c.callee,
        kind: "calls",
        src_line: c.line,
        src_col: c.col,
      });
    }

    // Imports -> file-level edge from first symbol or synthetic module symbol
    let moduleId = inFileSymbols.values().next().value;
    if (moduleId == null && parsed.imports.length > 0) {
      moduleId = this.db.insertSymbol({
        file_id: fileId,
        name: "__module__",
        qualified_name: `${relPath}::__module__`,
        kind: "module",
        start_line: 1,
        end_line: 1,
        start_col: 0,
        end_col: 0,
        signature: null,
        doc: null,
        is_exported: 0,
      });
    }
    for (const imp of parsed.imports) {
      if (moduleId == null) break;
      this.db.insertEdge({
        src_symbol_id: moduleId,
        dst_symbol_id: null,
        dst_unresolved: imp.path,
        kind: "imports",
        src_line: imp.line,
        src_col: 0,
      });
    }

    return true;
  }

  /** Resolve dst_unresolved using global name lookups. */
  resolveUnresolved(): number {
    let resolved = 0;
    const rows = this.db.db.prepare(
      "SELECT id, dst_unresolved, kind FROM edges WHERE dst_unresolved IS NOT NULL AND dst_symbol_id IS NULL"
    ).all() as { id: number; dst_unresolved: string; kind: string }[];

    const update = this.db.db.prepare(
      "UPDATE edges SET dst_symbol_id = ?, dst_unresolved = NULL WHERE id = ?"
    );

    const findByName = this.db.db.prepare(
      "SELECT id FROM symbols WHERE name = ? LIMIT 1"
    );

    this.db.transaction(() => {
      for (const r of rows) {
        if (r.kind === "imports") continue; // imports are paths, not symbols
        const hit = findByName.get(r.dst_unresolved) as { id: number } | undefined;
        if (hit) {
          update.run(hit.id, r.id);
          resolved++;
        }
      }
    });

    return resolved;
  }
}
