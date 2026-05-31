import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Kind =
  | "function" | "class" | "method" | "interface" | "type" | "enum"
  | "const" | "var" | "module" | "component" | "trait" | "struct" | "impl";

export type EdgeKind =
  | "calls" | "imports" | "inherits" | "implements"
  | "uses_type" | "reads" | "writes" | "exports";

export interface FileRow {
  id: number;
  path: string;
  language: string;
  size: number;
  mtime: number;
  hash: string;
  indexed_at: number;
}

export interface SymbolRow {
  id: number;
  file_id: number;
  name: string;
  qualified_name: string;
  kind: string;
  start_line: number;
  end_line: number;
  start_col: number | null;
  end_col: number | null;
  signature: string | null;
  doc: string | null;
  is_exported: number;
}

export interface EdgeRow {
  id: number;
  src_symbol_id: number;
  dst_symbol_id: number | null;
  dst_unresolved: string | null;
  kind: string;
  src_line: number;
  src_col: number | null;
}

// Fix 92: doc index rows.
export interface DocRow {
  id: number;
  path: string;
  doc_type: string;
  size: number;
  mtime: number;
  hash: string;
  indexed_at: number;
}

export interface DocChunkRow {
  id: number;
  doc_id: number;
  chunk_kind: string;
  title: string | null;
  level: number;
  line_start: number;
  line_end: number;
  body: string | null;
}

export interface DocHit {
  path: string;
  doc_type: string;
  chunk_kind: string;
  title: string | null;
  level: number;
  line_start: number;
  line_end: number;
  snippet: string;
}

export class CodeGraphDB {
  readonly db: Database.Database;

  constructor(public readonly dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    const schemaPath = resolve(__dirname, "schema.sql");
    const schema = readFileSync(schemaPath, "utf8");
    this.db.exec(schema);
    this.setMeta("schema_version", "1");
  }

  setMeta(key: string, value: string) {
    this.db.prepare(
      "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    ).run(key, value);
  }

  getMeta(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }

  upsertFile(row: Omit<FileRow, "id">): number {
    const exist = this.db.prepare("SELECT id FROM files WHERE path = ?").get(row.path) as { id: number } | undefined;
    if (exist) {
      this.db.prepare(
        "UPDATE files SET language=?, size=?, mtime=?, hash=?, indexed_at=? WHERE id=?"
      ).run(row.language, row.size, row.mtime, row.hash, row.indexed_at, exist.id);
      this.db.prepare("DELETE FROM symbols WHERE file_id = ?").run(exist.id);
      return exist.id;
    }
    const r = this.db.prepare(
      "INSERT INTO files(path,language,size,mtime,hash,indexed_at) VALUES(?,?,?,?,?,?)"
    ).run(row.path, row.language, row.size, row.mtime, row.hash, row.indexed_at);
    return Number(r.lastInsertRowid);
  }

  deleteFile(path: string) {
    // Clean up symbols too (so no orphans remain) — upsertFile used to delete
    // them manually on the update path; same behavior for single deletes.
    const row = this.db.prepare("SELECT id FROM files WHERE path = ?").get(path) as { id: number } | undefined;
    if (row) this.db.prepare("DELETE FROM symbols WHERE file_id = ?").run(row.id);
    this.db.prepare("DELETE FROM files WHERE path = ?").run(path);
  }

  // Fix CODEGRAPH-BLOAT: clear ALL code tables before a full index. Old
  // behavior: fullIndex only upserted current files, so rows for files that
  // dropped out of the scan (added to ignore or deleted) stayed in the DB
  // PERMANENTLY. node_modules/vendor (21k+ files) indexed before Fix 46 thus
  // lingered in the DB forever (EmlakCopilot: 22k files / 110k symbols — the
  // real project is ~1.2k). code_search returned this junk and drowned out the
  // project code. clearCode + full reindex = clean graph. docs/doc_chunks are
  // SEPARATE (docIndexer) and untouched.
  clearCode(): void {
    this.db.exec("DELETE FROM edges; DELETE FROM symbols; DELETE FROM files;");
    // Fix CODEGRAPH-BLOAT-2: DELETE does NOT return free pages to disk — pages
    // left over from the old 22k-file bloat kept inflating the file
    // (EmlakCopilot 107MB / really ~1053 files). VACUUM rewrites the file and
    // reclaims empty pages. Here the code tables are empty so VACUUM is cheap;
    // the re-index then grows the file to its real size. try-guard so a
    // lock/disk-full edge case doesn't break the index.
    try {
      this.db.exec("VACUUM;");
    } catch {
      // Skipped if VACUUM runs inside a transaction or another connection holds a lock.
    }
  }

  insertSymbol(s: Omit<SymbolRow, "id">): number {
    const r = this.db.prepare(
      `INSERT INTO symbols(file_id,name,qualified_name,kind,start_line,end_line,start_col,end_col,signature,doc,is_exported)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      s.file_id, s.name, s.qualified_name, s.kind,
      s.start_line, s.end_line, s.start_col, s.end_col,
      s.signature, s.doc, s.is_exported
    );
    return Number(r.lastInsertRowid);
  }

  insertEdge(e: Omit<EdgeRow, "id">) {
    this.db.prepare(
      `INSERT INTO edges(src_symbol_id,dst_symbol_id,dst_unresolved,kind,src_line,src_col)
       VALUES(?,?,?,?,?,?)`
    ).run(e.src_symbol_id, e.dst_symbol_id, e.dst_unresolved, e.kind, e.src_line, e.src_col);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  resolveSymbol(qualifiedName: string): SymbolRow | null {
    const r = this.db.prepare(
      "SELECT * FROM symbols WHERE qualified_name = ? LIMIT 1"
    ).get(qualifiedName) as SymbolRow | undefined;
    return r ?? null;
  }

  findSymbolsByName(name: string, limit = 20): SymbolRow[] {
    return this.db.prepare(
      "SELECT * FROM symbols WHERE name = ? LIMIT ?"
    ).all(name, limit) as SymbolRow[];
  }

  searchSymbols(query: string, limit = 20): SymbolRow[] {
    return this.db.prepare(
      `SELECT s.* FROM symbols_fts f
       JOIN symbols s ON s.id = f.rowid
       WHERE symbols_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    ).all(query, limit) as SymbolRow[];
  }

  callers(symbolId: number, depth = 2): SymbolRow[] {
    return this.db.prepare(
      `WITH RECURSIVE c(id, d) AS (
        SELECT src_symbol_id, 1 FROM edges WHERE dst_symbol_id = ? AND kind = 'calls'
        UNION
        SELECT e.src_symbol_id, c.d + 1 FROM edges e JOIN c ON e.dst_symbol_id = c.id
        WHERE e.kind = 'calls' AND c.d < ?
      )
      SELECT DISTINCT s.* FROM c JOIN symbols s ON s.id = c.id`
    ).all(symbolId, depth) as SymbolRow[];
  }

  callees(symbolId: number, depth = 2): SymbolRow[] {
    return this.db.prepare(
      `WITH RECURSIVE c(id, d) AS (
        SELECT dst_symbol_id, 1 FROM edges WHERE src_symbol_id = ? AND kind = 'calls' AND dst_symbol_id IS NOT NULL
        UNION
        SELECT e.dst_symbol_id, c.d + 1 FROM edges e JOIN c ON e.src_symbol_id = c.id
        WHERE e.kind = 'calls' AND e.dst_symbol_id IS NOT NULL AND c.d < ?
      )
      SELECT DISTINCT s.* FROM c JOIN symbols s ON s.id = c.id WHERE s.id IS NOT NULL`
    ).all(symbolId, depth) as SymbolRow[];
  }

  stats() {
    const f = this.db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number };
    const s = this.db.prepare("SELECT COUNT(*) as c FROM symbols").get() as { c: number };
    const e = this.db.prepare("SELECT COUNT(*) as c FROM edges").get() as { c: number };
    const langs = this.db.prepare("SELECT language, COUNT(*) as c FROM files GROUP BY language").all() as { language: string; c: number }[];
    // Fix 53: kind distribution (function/class/method/...) + edge kind
    // distribution, added so they can be shown in the UI.
    const kinds = this.db.prepare("SELECT kind, COUNT(*) as c FROM symbols GROUP BY kind").all() as { kind: string; c: number }[];
    const edgeKinds = this.db.prepare("SELECT kind, COUNT(*) as c FROM edges GROUP BY kind").all() as { kind: string; c: number }[];
    // Fix 92: doc statistics.
    const docs = this.db.prepare("SELECT COUNT(*) as c FROM docs").get() as { c: number };
    const chunks = this.db.prepare("SELECT COUNT(*) as c FROM doc_chunks").get() as { c: number };
    const docTypes = this.db.prepare("SELECT doc_type, COUNT(*) as c FROM docs GROUP BY doc_type").all() as { doc_type: string; c: number }[];
    return {
      files: f.c,
      symbols: s.c,
      edges: e.c,
      byLanguage: Object.fromEntries(langs.map((l) => [l.language, l.c])),
      // Alias for UI consumer (CodeGraphScreen uses `languages` + `kinds`)
      languages: Object.fromEntries(langs.map((l) => [l.language, l.c])),
      kinds: Object.fromEntries(kinds.map((k) => [k.kind, k.c])),
      edgeKinds: Object.fromEntries(edgeKinds.map((k) => [k.kind, k.c])),
      docs: docs.c,
      docChunks: chunks.c,
      docTypes: Object.fromEntries(docTypes.map((d) => [d.doc_type, d.c])),
    };
  }

  // --- Fix 92: doc index API ------------------------------------------------

  upsertDoc(row: Omit<DocRow, "id">): number {
    const exist = this.db.prepare("SELECT id FROM docs WHERE path = ?").get(row.path) as { id: number } | undefined;
    if (exist) {
      this.db.prepare(
        "UPDATE docs SET doc_type=?, size=?, mtime=?, hash=?, indexed_at=? WHERE id=?"
      ).run(row.doc_type, row.size, row.mtime, row.hash, row.indexed_at, exist.id);
      this.db.prepare("DELETE FROM doc_chunks WHERE doc_id = ?").run(exist.id);
      return exist.id;
    }
    const r = this.db.prepare(
      "INSERT INTO docs(path,doc_type,size,mtime,hash,indexed_at) VALUES(?,?,?,?,?,?)"
    ).run(row.path, row.doc_type, row.size, row.mtime, row.hash, row.indexed_at);
    return Number(r.lastInsertRowid);
  }

  deleteDoc(path: string) {
    this.db.prepare("DELETE FROM docs WHERE path = ?").run(path);
  }

  insertDocChunk(c: Omit<DocChunkRow, "id">): number {
    const r = this.db.prepare(
      `INSERT INTO doc_chunks(doc_id,chunk_kind,title,level,line_start,line_end,body)
       VALUES(?,?,?,?,?,?,?)`
    ).run(c.doc_id, c.chunk_kind, c.title, c.level, c.line_start, c.line_end, c.body);
    return Number(r.lastInsertRowid);
  }

  searchDocs(query: string, opts: { docTypes?: string[]; pathLike?: string; limit?: number } = {}): DocHit[] {
    const safe = query.replace(/['"]/g, " ").trim();
    if (!safe) return [];
    const limit = opts.limit ?? 20;
    const where: string[] = ["doc_chunks_fts MATCH ?"];
    const args: unknown[] = [safe];
    if (opts.docTypes && opts.docTypes.length > 0) {
      where.push(`d.doc_type IN (${opts.docTypes.map(() => "?").join(",")})`);
      args.push(...opts.docTypes);
    }
    if (opts.pathLike) {
      where.push("d.path LIKE ?");
      args.push(opts.pathLike.replace(/\*/g, "%"));
    }
    args.push(limit);
    try {
      const rows = this.db.prepare(
        `SELECT d.path, d.doc_type, c.chunk_kind, c.title, c.level, c.line_start, c.line_end,
                snippet(doc_chunks_fts, 1, '[[', ']]', '...', 16) as snippet
         FROM doc_chunks_fts f
         JOIN doc_chunks c ON c.id = f.rowid
         JOIN docs d ON d.id = c.doc_id
         WHERE ${where.join(" AND ")}
         ORDER BY rank
         LIMIT ?`
      ).all(...args) as DocHit[];
      return rows;
    } catch {
      return [];
    }
  }

  docOutline(path: string): DocChunkRow[] {
    const doc = this.db.prepare("SELECT id FROM docs WHERE path = ?").get(path) as { id: number } | undefined;
    if (!doc) return [];
    return this.db.prepare(
      `SELECT * FROM doc_chunks WHERE doc_id = ? ORDER BY line_start LIMIT 500`
    ).all(doc.id) as DocChunkRow[];
  }

  docsList(opts: { glob?: string; docType?: string; limit?: number } = {}): { path: string; doc_type: string; size: number }[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.glob) { where.push("path LIKE ?"); args.push(opts.glob.replace(/\*/g, "%")); }
    if (opts.docType) { where.push("doc_type = ?"); args.push(opts.docType); }
    const limit = opts.limit ?? 200;
    const sql = `SELECT path, doc_type, size FROM docs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY path LIMIT ${limit}`;
    return this.db.prepare(sql).all(...args) as { path: string; doc_type: string; size: number }[];
  }

  close() {
    this.db.close();
  }
}
