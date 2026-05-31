// CodeGraph WS handler — UI queries (stats/search/node/callers/callees/impact/
// imports/files/rebuild). F9 extra split: main.ts's ServerHandlers.onCodegraph
// callback comes from this module.

import type { CodeGraph } from "./codegraph/index.js";
import { setActiveCodeGraph } from "./codegraph/index.js";
import type { SymbolRow } from "./codegraph/db.js";
import type { ClientMessage } from "./server.js";

export interface CodegraphHandlerDeps {
  projectName: string;
  projectRoot: string;
  // Mutable getter — codeGraphInstance changes during lazy build.
  getCodeGraphInstance: () => CodeGraph | null;
  setCodeGraphInstance: (g: CodeGraph | null) => void;
  isBuilding: () => boolean;
  ensureCodeGraph: () => Promise<void>;
}

export function createCodegraphHandler(deps: CodegraphHandlerDeps) {
  const {
    projectName,
    projectRoot,
    getCodeGraphInstance,
    setCodeGraphInstance,
    isBuilding,
    ensureCodeGraph,
  } = deps;

  return async function onCodegraph(
    op: NonNullable<ClientMessage["op"]>,
    params: Record<string, unknown>,
  ): Promise<{ ok: boolean; sonuc?: unknown; hata?: string }> {
    const g = getCodeGraphInstance();
    if (!g && op !== "rebuild") {
      return { ok: false, hata: "CodeGraph is not ready (not indexed yet)" };
    }
    try {
      switch (op) {
        case "stats": {
          const s = g!.stats();
          // ProjectName + lastFullIndex + buildPhase
          const meta = g!.db.db.prepare("SELECT key, value FROM meta").all() as { key: string; value: string }[];
          const metaMap: Record<string, string> = {};
          for (const m of meta) metaMap[m.key] = m.value;
          return {
            ok: true,
            sonuc: {
              ...s,
              projectName,
              projectRoot,
              lastFullIndex: metaMap.last_full_index ? Number(metaMap.last_full_index) : null,
              building: isBuilding(),
              ready: !!getCodeGraphInstance(),
            },
          };
        }
        case "search": {
          const query = String(params.query ?? "");
          const limit = Number(params.limit ?? 30);
          // Optional kind filter — sent when a Symbol Types chip is clicked in
          // the UI. Query empty + kind set: top N symbols of that kind.
          // Query set + kind set: FTS5 + post-filter.
          const kind = String(params.kind ?? "").trim();
          const hasQuery = query.trim().length > 0;
          if (!hasQuery && !kind) return { ok: true, sonuc: [] };
          // Attach file path for UX
          const files = g!.db.db.prepare("SELECT id, path FROM files").all() as { id: number; path: string }[];
          const fileMap = new Map(files.map((f) => [f.id, f.path]));
          let rows: SymbolRow[];
          if (!hasQuery && kind) {
            // Kind-only: sorted by name directly from the symbols table.
            rows = g!.db.db.prepare(
              "SELECT * FROM symbols WHERE kind = ? ORDER BY name LIMIT ?"
            ).all(kind, limit) as SymbolRow[];
          } else {
            rows = g!.search(query, limit);
            if (kind) rows = rows.filter((r) => r.kind === kind);
          }
          return {
            ok: true,
            sonuc: rows.map((r) => ({
              id: r.id,
              name: r.name,
              qname: r.qualified_name,
              kind: r.kind,
              startLine: r.start_line,
              endLine: r.end_line,
              signature: r.signature,
              isExported: r.is_exported === 1,
              path: fileMap.get(r.file_id) ?? "?",
            })),
          };
        }
        case "node": {
          const qname = String(params.qname ?? "");
          const node = g!.node(qname);
          if (!node) return { ok: true, sonuc: null };
          const file = g!.db.db.prepare("SELECT path FROM files WHERE id = ?").get(node.file_id) as { path: string } | undefined;
          return {
            ok: true,
            sonuc: {
              id: node.id,
              name: node.name,
              qname: node.qualified_name,
              kind: node.kind,
              startLine: node.start_line,
              endLine: node.end_line,
              signature: node.signature,
              isExported: node.is_exported === 1,
              path: file?.path ?? "?",
            },
          };
        }
        case "callers": {
          const symbol = String(params.symbol ?? "");
          const depth = Number(params.depth ?? 2);
          const rows = g!.callers(symbol, depth);
          return { ok: true, sonuc: rows.map((r) => ({ name: r.name, qname: r.qualified_name, kind: r.kind, startLine: r.start_line })) };
        }
        case "callees": {
          const symbol = String(params.symbol ?? "");
          const depth = Number(params.depth ?? 2);
          const rows = g!.callees(symbol, depth);
          return { ok: true, sonuc: rows.map((r) => ({ name: r.name, qname: r.qualified_name, kind: r.kind, startLine: r.start_line })) };
        }
        case "impact": {
          const path = String(params.path ?? "");
          const depth = Number(params.depth ?? 3);
          const rows = g!.impact(path, depth);
          return { ok: true, sonuc: rows.map((r) => ({ name: r.name, qname: r.qualified_name, kind: r.kind })) };
        }
        case "imports": {
          const path = String(params.path ?? "");
          return { ok: true, sonuc: g!.imports(path) };
        }
        case "files": {
          const glob = params.glob ? String(params.glob) : undefined;
          const kind = params.kind ? String(params.kind) : undefined;
          return { ok: true, sonuc: g!.files(glob, kind) };
        }
        case "rebuild": {
          // Reindex — null if codegraph is disabled. Manual trigger.
          if (isBuilding()) {
            return { ok: false, hata: "Indexing is already in progress" };
          }
          const current = getCodeGraphInstance();
          if (current) {
            await current.dispose();
            setCodeGraphInstance(null);
            setActiveCodeGraph(null);
          }
          // Lazy build is retriggered
          void ensureCodeGraph();
          return { ok: true, sonuc: { tetiklendi: true } };
        }
        default:
          return { ok: false, hata: `Unknown op: ${op}` };
      }
    } catch (e) {
      return { ok: false, hata: (e as Error).message };
    }
  };
}
