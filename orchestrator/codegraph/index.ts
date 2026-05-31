import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { CodeGraphDB, type SymbolRow, type DocHit, type DocChunkRow } from "./db.js";
import { Indexer, type ProgressCb } from "./indexer.js";
import { DocIndexer } from "./docIndexer.js";
import { CodeGraphWatcher } from "./watcher.js";

// Process-wide active CodeGraph registry. main.ts sets after build; worker /
// specialist / advisor import via getActiveCodeGraph() to construct their
// dedicated mcp server (mcp__codegraph__*). Same process => same instance.
let _activeCodeGraph: CodeGraph | null = null;
export function setActiveCodeGraph(g: CodeGraph | null) { _activeCodeGraph = g; }
export function getActiveCodeGraph(): CodeGraph | null { return _activeCodeGraph; }

export interface CodeGraphOptions {
  rootDir: string;
  dbPath?: string; // default: <rootDir>/.architect/codegraph.db
  watch?: boolean;
  onProgress?: ProgressCb;
  onChange?: (count: number) => void;
}

export class CodeGraph {
  readonly db: CodeGraphDB;
  readonly indexer: Indexer;
  readonly docIndexer: DocIndexer;
  private watcher: CodeGraphWatcher | null = null;
  private readonly opts: CodeGraphOptions;

  constructor(opts: CodeGraphOptions) {
    this.opts = opts;
    const dbPath = opts.dbPath ?? resolve(opts.rootDir, ".architect", "codegraph.db");
    if (!existsSync(dirname(dbPath))) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new CodeGraphDB(dbPath);
    this.indexer = new Indexer(opts.rootDir, this.db);
    this.docIndexer = new DocIndexer(opts.rootDir, this.db);
  }

  async build() {
    const codeResult = await this.indexer.fullIndex({ onProgress: this.opts.onProgress });
    // Fix 92: index docs as well (md/json/yaml/toml/txt).
    const docResult = await this.docIndexer.fullIndex({});
    return { ...codeResult, docs: docResult.docs, docChunks: docResult.chunks };
  }

  startWatch() {
    if (this.watcher || !this.opts.watch) return;
    this.watcher = new CodeGraphWatcher(this.opts.rootDir, this.indexer, {
      onChange: this.opts.onChange,
      docIndexer: this.docIndexer,
    });
    this.watcher.start();
  }

  async dispose() {
    if (this.watcher) await this.watcher.stop();
    this.db.close();
  }

  // Public query API
  search(query: string, limit = 20): SymbolRow[] {
    // FTS5 needs escaped non-word chars; for simple names just match raw.
    const safe = query.replace(/['"]/g, " ").trim();
    if (!safe) return [];
    try {
      return this.db.searchSymbols(safe + "*", limit);
    } catch {
      return this.db.findSymbolsByName(safe, limit);
    }
  }

  node(qualifiedName: string): SymbolRow | null {
    return this.db.resolveSymbol(qualifiedName);
  }

  callers(symbolName: string, depth = 2): SymbolRow[] {
    const sym = this.findSymbolByAnyName(symbolName);
    if (!sym) return [];
    return this.db.callers(sym.id, depth);
  }

  callees(symbolName: string, depth = 2): SymbolRow[] {
    const sym = this.findSymbolByAnyName(symbolName);
    if (!sym) return [];
    return this.db.callees(sym.id, depth);
  }

  impact(filePath: string, depth = 3): SymbolRow[] {
    const fileRow = this.db.db.prepare("SELECT id FROM files WHERE path = ?").get(filePath) as { id: number } | undefined;
    if (!fileRow) return [];
    const syms = this.db.db.prepare("SELECT id FROM symbols WHERE file_id = ?").all(fileRow.id) as { id: number }[];
    const out = new Map<number, SymbolRow>();
    for (const s of syms) {
      for (const c of this.db.callers(s.id, depth)) {
        out.set(c.id, c);
      }
    }
    return Array.from(out.values());
  }

  imports(filePath: string): { inbound: string[]; outbound: string[] } {
    const fileRow = this.db.db.prepare("SELECT id FROM files WHERE path = ?").get(filePath) as { id: number } | undefined;
    if (!fileRow) return { inbound: [], outbound: [] };
    const outbound = (this.db.db.prepare(
      `SELECT DISTINCT e.dst_unresolved FROM edges e
       JOIN symbols s ON s.id = e.src_symbol_id
       WHERE s.file_id = ? AND e.kind = 'imports' AND e.dst_unresolved IS NOT NULL`
    ).all(fileRow.id) as { dst_unresolved: string }[]).map((r) => r.dst_unresolved);
    const inbound = (this.db.db.prepare(
      `SELECT DISTINCT f.path FROM edges e
       JOIN symbols s ON s.id = e.dst_symbol_id
       JOIN files f ON f.id = s.file_id
       WHERE e.kind = 'imports' AND s.file_id = ?`
    ).all(fileRow.id) as { path: string }[]).map((r) => r.path);
    return { inbound, outbound };
  }

  files(glob?: string, kind?: string): string[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (glob) { where.push("path LIKE ?"); args.push(glob.replace(/\*/g, "%")); }
    if (kind) { where.push("language = ?"); args.push(kind); }
    const sql = `SELECT path FROM files ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY path LIMIT 500`;
    return (this.db.db.prepare(sql).all(...args) as { path: string }[]).map((r) => r.path);
  }

  stats() {
    return this.db.stats();
  }

  // Fix 92: doc query API.
  searchDocs(
    query: string,
    opts: { docTypes?: string[]; pathLike?: string; limit?: number } = {},
  ): DocHit[] {
    return this.db.searchDocs(query, opts);
  }

  docOutline(path: string): DocChunkRow[] {
    return this.db.docOutline(path);
  }

  docsList(opts: { glob?: string; docType?: string; limit?: number } = {}) {
    return this.db.docsList(opts);
  }

  private findSymbolByAnyName(name: string): SymbolRow | null {
    if (name.includes("::")) {
      const r = this.db.resolveSymbol(name);
      if (r) return r;
    }
    const arr = this.db.findSymbolsByName(name, 1);
    return arr[0] ?? null;
  }
}
