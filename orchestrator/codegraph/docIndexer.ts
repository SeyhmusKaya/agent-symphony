import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { relative, sep } from "node:path";
import fg from "fast-glob";
import { CodeGraphDB } from "./db.js";
import { detectDocType, parseDoc } from "./docParser.js";

// Fix 92: doc index — line-based chunk index for md/json/yaml/toml/txt.
// Runs in parallel with the Indexer (symbol graph), same db.

const DOC_GLOBS = [
  "**/*.md",
  "**/*.mdx",
  "**/*.markdown",
  "**/*.json",
  "**/*.jsonc",
  "**/*.yaml",
  "**/*.yml",
  "**/*.toml",
  "**/*.txt",
  "**/*.rst",
];

// Same as Indexer.DEFAULT_IGNORE — code and docs scan the same folder tree.
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
  "**/phpunit/**",
  "**/PHPUnit/**",
  "**/*.min.json",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
];

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function hashOf(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

export interface DocIndexProgress {
  total: number;
  processed: number;
  current?: string;
}

export type DocProgressCb = (p: DocIndexProgress) => void;

export interface DocIndexOptions {
  ignore?: string[];
  maxFileBytes?: number;
  onProgress?: DocProgressCb;
}

export class DocIndexer {
  constructor(
    public readonly rootDir: string,
    public readonly db: CodeGraphDB,
  ) {}

  async fullIndex(opts: DocIndexOptions = {}): Promise<{ docs: number; chunks: number; durationMs: number }> {
    const start = Date.now();
    const ignore = [...DEFAULT_IGNORE, ...(opts.ignore ?? [])];
    const maxBytes = opts.maxFileBytes ?? 500_000; // docs are smaller: 500KB cap

    const paths = await fg(DOC_GLOBS, {
      cwd: this.rootDir,
      ignore,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      dot: false,
    });

    let processed = 0;
    for (const p of paths) {
      await this.indexFile(p, maxBytes);
      processed++;
      opts.onProgress?.({ total: paths.length, processed, current: toPosix(relative(this.rootDir, p)) });
    }

    const stats = this.db.stats();
    return {
      docs: stats.docs ?? 0,
      chunks: stats.docChunks ?? 0,
      durationMs: Date.now() - start,
    };
  }

  async indexFile(absPath: string, maxBytes = 500_000): Promise<boolean> {
    const t = detectDocType(absPath);
    if (!t) return false;
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

    const chunks = parseDoc(absPath, src);
    if (!chunks || chunks.length === 0) return false;

    const relPath = toPosix(relative(this.rootDir, absPath));
    const fileHash = hashOf(src);

    return this.db.transaction(() => {
      const docId = this.db.upsertDoc({
        path: relPath,
        doc_type: t,
        size: st.size,
        mtime: Math.floor(st.mtimeMs),
        hash: fileHash,
        indexed_at: Date.now(),
      });
      for (const c of chunks) {
        this.db.insertDocChunk({
          doc_id: docId,
          chunk_kind: c.kind,
          title: c.title,
          level: c.level,
          line_start: c.lineStart,
          line_end: c.lineEnd,
          body: c.body,
        });
      }
      return true;
    });
  }
}
