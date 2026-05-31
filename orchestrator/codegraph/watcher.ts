import chokidar, { type FSWatcher } from "chokidar";
import { resolve, extname } from "node:path";
import type { Indexer } from "./indexer.js";
import type { DocIndexer } from "./docIndexer.js";
import { detectDocType } from "./docParser.js";

export interface WatcherOptions {
  ignored?: (string | RegExp)[];
  debounceMs?: number;
  onChange?: (count: number) => void;
  // Fix 92: doc index integration.
  docIndexer?: DocIndexer;
}

// Fix 46+: in sync with indexer.ts DEFAULT_IGNORE. While the watcher emits
// individual files it was UNAWARE of the indexer's ignore list — vendor/phpunit
// changes called indexFile() every time (even if the indexer's internal
// detectLanguage check rejected the file type, the stat/io cost was paid).
// Persistent overhead: 46k+ vendor files triggered a re-index scan every day.
// Fix: apply the same ignore at the watcher level too.
const DEFAULT_IGNORED = [
  /[/\\]node_modules[/\\]/,
  /[/\\]vendor[/\\]/,
  /[/\\]\.git[/\\]/,
  /[/\\]\.architect[/\\]/,
  /[/\\]\.architect-storage[/\\]/,
  /[/\\]dist[/\\]/,
  /[/\\]build[/\\]/,
  /[/\\]\.next[/\\]/,
  /[/\\]target[/\\]/,
  /[/\\]coverage[/\\]/,
  /[/\\]out[/\\]/,
  /[/\\]\.svelte-kit[/\\]/,
  /[/\\]src-tauri[/\\]target[/\\]/,
  /[/\\]__pycache__[/\\]/,
  /[/\\]\.venv[/\\]/,
  /[/\\]venv[/\\]/,
  /[/\\]storage[/\\]framework[/\\]/,
  /[/\\]storage[/\\]logs[/\\]/,
  /[/\\]bootstrap[/\\]cache[/\\]/,
  /[/\\]public[/\\]build[/\\]/,
  /[/\\]public[/\\]hot[/\\]/,
  /[/\\]\.pytest_cache[/\\]/,
  /[/\\]\.mypy_cache[/\\]/,
  /[/\\]\.ruff_cache[/\\]/,
  /[/\\]migrations[/\\]/,
  /[/\\]phpunit[/\\]/,
  /[/\\]PHPUnit[/\\]/,
];

export class CodeGraphWatcher {
  private watcher: FSWatcher | null = null;
  private pending = new Map<string, "change" | "delete">();
  private timer: NodeJS.Timeout | null = null;
  private readonly debounce: number;

  constructor(
    public readonly rootDir: string,
    public readonly indexer: Indexer,
    private readonly opts: WatcherOptions = {}
  ) {
    // Fix 106: debounce 2000 -> 500. The old value could hit stale data when
    // code_search ran right after the sef did an Edit/Write (~2.5s delay).
    // Single-file reindex with tree-sitter is <50ms; shortening the debounce
    // is safe for the sef's "write-then-search" pattern and keeps response time even.
    this.debounce = opts.debounceMs ?? 500;
  }

  start() {
    if (this.watcher) return;
    this.watcher = chokidar.watch(this.rootDir, {
      ignored: [...DEFAULT_IGNORED, ...(this.opts.ignored ?? [])],
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher
      .on("add", (p: string) => this.queue(p, "change"))
      .on("change", (p: string) => this.queue(p, "change"))
      .on("unlink", (p: string) => this.queue(p, "delete"));
  }

  private queue(absPath: string, op: "change" | "delete") {
    this.pending.set(resolve(absPath), op);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounce);
  }

  private async flush() {
    this.timer = null;
    if (this.pending.size === 0) return;
    const batch = Array.from(this.pending.entries());
    this.pending.clear();
    let count = 0;
    for (const [p, op] of batch) {
      // Fix 92: docs and code flow through separate paths.
      const isDoc = detectDocType(p) !== null;
      const isCode = !isDoc && [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".php", ".cs", ".razor", ".cshtml", ".py"].includes(extname(p).toLowerCase());
      if (op === "delete") {
        const rel = this.relPath(p);
        if (isDoc && this.opts.docIndexer) {
          this.indexer.db.deleteDoc(rel);
          count++;
        } else if (isCode) {
          this.indexer.db.deleteFile(rel);
          count++;
        }
      } else {
        if (isDoc && this.opts.docIndexer) {
          const ok = await this.opts.docIndexer.indexFile(p);
          if (ok) count++;
        } else if (isCode) {
          const ok = await this.indexer.indexFile(p);
          if (ok) count++;
        }
      }
    }
    if (count > 0) {
      this.indexer.resolveUnresolved();
      this.opts.onChange?.(count);
    }
  }

  private relPath(absPath: string): string {
    return absPath
      .replace(this.rootDir, "")
      .replace(/^[\\/]+/, "")
      .split("\\").join("/");
  }

  async stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
