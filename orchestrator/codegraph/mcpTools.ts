import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { CodeGraph } from "./index.js";

// Union avoidance for heterogeneous tool schemas: any[] return.
type AnyTool = ReturnType<typeof tool<never>>;

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(text: string) {
  return { content: [{ type: "text" as const, text: `ERROR: ${text}` }], isError: true };
}

function slim(rows: { name: string; qualified_name: string; kind: string; start_line: number; end_line: number; file_id: number }[]) {
  return rows.map((r) => ({
    name: r.name,
    qname: r.qualified_name,
    kind: r.kind,
    lines: `${r.start_line}-${r.end_line}`,
  }));
}

export function buildCodeGraphTools(getGraph: () => CodeGraph | null): AnyTool[] {
  const requireGraph = () => {
    const g = getGraph();
    if (!g) throw new Error("CodeGraph is not active. Index the project first.");
    return g;
  };

  const code_search = tool(
    "code_search",
    "Symbol search (FTS5). Quickly find function/class/method/type names. Use this FIRST, do not grep.",
    {
      query: z.string().describe("Symbol name or substring to search for"),
      limit: z.number().int().min(1).max(50).optional().describe("Max results (def 20)"),
    },
    async (args) => {
      try {
        const g = requireGraph();
        const rows = g.search(args.query, args.limit ?? 20);
        if (rows.length === 0) return ok(`(symbol not found: "${args.query}")`);
        return ok(JSON.stringify(slim(rows), null, 2));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  const code_node = tool(
    "code_node",
    "Get the full information for a single symbol (by qualified_name).",
    {
      qualified_name: z.string().describe("Example: orchestrator/main.ts::runChiefAttempt"),
    },
    async (args) => {
      try {
        const g = requireGraph();
        const r = g.node(args.qualified_name);
        if (!r) return ok(`(symbol not found: "${args.qualified_name}")`);
        return ok(JSON.stringify({
          name: r.name,
          qname: r.qualified_name,
          kind: r.kind,
          lines: `${r.start_line}-${r.end_line}`,
          file_id: r.file_id,
          signature: r.signature,
        }, null, 2));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  const code_callers = tool(
    "code_callers",
    "List the symbols that CALL a function/method. Use this instead of grep for 'who calls X'.",
    {
      symbol: z.string().describe("Symbol name (plain name or qualified_name)"),
      depth: z.number().int().min(1).max(5).optional().describe("Recursive depth (def 2)"),
    },
    async (args) => {
      try {
        const g = requireGraph();
        const rows = g.callers(args.symbol, args.depth ?? 2);
        if (rows.length === 0) return ok(`(no callers: "${args.symbol}")`);
        return ok(JSON.stringify(slim(rows), null, 2));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  const code_callees = tool(
    "code_callees",
    "List the symbols that a function CALLS (outbound).",
    {
      symbol: z.string(),
      depth: z.number().int().min(1).max(5).optional(),
    },
    async (args) => {
      try {
        const g = requireGraph();
        const rows = g.callees(args.symbol, args.depth ?? 2);
        if (rows.length === 0) return ok(`(no callees: "${args.symbol}")`);
        return ok(JSON.stringify(slim(rows), null, 2));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  const code_impact = tool(
    "code_impact",
    "Which symbols are affected if a file changes (transitive callers).",
    {
      path: z.string().describe("File path (relative to rootDir, posix)"),
      depth: z.number().int().min(1).max(5).optional(),
    },
    async (args) => {
      try {
        const g = requireGraph();
        const rows = g.impact(args.path, args.depth ?? 3);
        if (rows.length === 0) return ok(`(no affected symbols: "${args.path}")`);
        return ok(JSON.stringify(slim(rows).slice(0, 50), null, 2));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  const code_imports = tool(
    "code_imports",
    "List of a file's inbound (who imports it) + outbound (what it imports).",
    {
      path: z.string(),
    },
    async (args) => {
      try {
        const g = requireGraph();
        const r = g.imports(args.path);
        return ok(JSON.stringify(r, null, 2));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  const code_files = tool(
    "code_files",
    "List the files in the index (with a glob or language filter).",
    {
      glob: z.string().optional().describe("Example: 'orchestrator/*'"),
      kind: z.string().optional().describe("Language: typescript|javascript|php|csharp|python|razor"),
    },
    async (args) => {
      try {
        const g = requireGraph();
        const list = g.files(args.glob, args.kind);
        return ok(list.length ? list.join("\n") : "(no files)");
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  const code_stats = tool(
    "code_stats",
    "CodeGraph statistics: file/symbol/edge counts, language distribution.",
    {},
    async () => {
      try {
        const g = requireGraph();
        return ok(JSON.stringify(g.stats(), null, 2));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // Fix 92: document tool set.
  const search_docs = tool(
    "search_docs",
    "FTS search in md/json/yaml/toml/txt files. Use THIS instead of grep/Read for README, CLAUDE.md, package.json, tsconfig, the docs/ folder. Result: file path + line + snippet.",
    {
      query: z.string().describe("Text/keyword to search for"),
      docTypes: z.array(z.enum(["md", "json", "yaml", "toml", "txt"])).optional().describe("Filter: search only these types"),
      pathLike: z.string().optional().describe("Path filter (LIKE pattern, example 'docs/*')"),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async (args) => {
      try {
        const g = requireGraph();
        const rows = g.searchDocs(args.query, {
          docTypes: args.docTypes,
          pathLike: args.pathLike,
          limit: args.limit ?? 20,
        });
        if (rows.length === 0) return ok(`(document not found: "${args.query}")`);
        const slim = rows.map((r) => ({
          path: r.path,
          type: r.doc_type,
          title: r.title,
          lines: r.line_start === r.line_end ? String(r.line_start) : `${r.line_start}-${r.line_end}`,
          snippet: r.snippet,
        }));
        return ok(JSON.stringify(slim, null, 2));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  const get_doc_outline = tool(
    "get_doc_outline",
    "Structure of an md/json/yaml file: heading tree for md, key list for json. Get the outline before Read; reading only the relevant section is enough.",
    {
      path: z.string().describe("File path (relative to rootDir, posix)"),
    },
    async (args) => {
      try {
        const g = requireGraph();
        const rows = g.docOutline(args.path);
        if (rows.length === 0) return ok(`(outline not found: "${args.path}")`);
        const slim = rows.map((r) => ({
          kind: r.chunk_kind,
          title: r.title,
          level: r.level,
          lines: r.line_start === r.line_end ? String(r.line_start) : `${r.line_start}-${r.line_end}`,
        }));
        return ok(JSON.stringify(slim, null, 2));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  const list_docs = tool(
    "list_docs",
    "List the documents in the index (md/json/yaml/toml/txt).",
    {
      glob: z.string().optional().describe("Path LIKE pattern, example 'docs/*'"),
      docType: z.enum(["md", "json", "yaml", "toml", "txt"]).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    async (args) => {
      try {
        const g = requireGraph();
        const rows = g.docsList({ glob: args.glob, docType: args.docType, limit: args.limit ?? 200 });
        if (rows.length === 0) return ok("(no documents)");
        return ok(rows.map((r) => `${r.doc_type}\t${r.size}\t${r.path}`).join("\n"));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  return [
    code_search,
    code_node,
    code_callers,
    code_callees,
    code_impact,
    code_imports,
    code_files,
    code_stats,
    search_docs,
    get_doc_outline,
    list_docs,
  ] as unknown as AnyTool[];
}

// Standalone MCP server for sub-agents (worker / specialist / advisor).
// Mimar already has these tools via chiefServer; sub-agents get a dedicated
// `codegraph` namespace -> mcp__codegraph__code_search etc.
export function buildCodeGraphMcpServer(getGraph: () => CodeGraph | null) {
  return createSdkMcpServer({
    name: "codegraph",
    version: "0.1.0",
    tools: buildCodeGraphTools(getGraph) as never,
  });
}

export const CODEGRAPH_TOOL_NAMES_FOR_SUBAGENTS = [
  "mcp__codegraph__code_search",
  "mcp__codegraph__code_node",
  "mcp__codegraph__code_callers",
  "mcp__codegraph__code_callees",
  "mcp__codegraph__code_impact",
  "mcp__codegraph__code_imports",
  "mcp__codegraph__code_files",
  "mcp__codegraph__code_stats",
  "mcp__codegraph__search_docs",
  "mcp__codegraph__get_doc_outline",
  "mcp__codegraph__list_docs",
];
