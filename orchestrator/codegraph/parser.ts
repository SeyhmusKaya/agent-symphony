import Parser from "tree-sitter";
import { extname } from "node:path";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Language =
  | "typescript" | "tsx" | "javascript" | "jsx"
  | "php" | "csharp" | "razor" | "python";

const EXT_MAP: Record<string, Language> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "jsx",
  ".php": "php",
  ".cs": "csharp",
  ".razor": "razor",
  ".cshtml": "razor",
  ".py": "python",
};

export function detectLanguage(filePath: string): Language | null {
  const ext = extname(filePath).toLowerCase();
  return EXT_MAP[ext] ?? null;
}

const grammarsLoaded: Partial<Record<Language, unknown>> = {};
const queriesCache: Partial<Record<string, Parser.Query>> = {};
let grammarsLoading: Promise<void> | null = null;

async function loadGrammars() {
  if (grammarsLoading) return grammarsLoading;
  grammarsLoading = (async () => {
    const TS = await import("tree-sitter-typescript");
    const JS = await import("tree-sitter-javascript");
    const PHP = await import("tree-sitter-php");
    const CS = await import("tree-sitter-c-sharp");
    const PY = await import("tree-sitter-python");
    const tsMod = (TS.default ?? TS) as { typescript: unknown; tsx: unknown };
    const phpMod = (PHP.default ?? PHP) as { php: unknown; php_only: unknown };
    grammarsLoaded.typescript = tsMod.typescript;
    grammarsLoaded.tsx = tsMod.tsx;
    grammarsLoaded.javascript = JS.default ?? JS;
    grammarsLoaded.jsx = JS.default ?? JS;
    grammarsLoaded.php = phpMod.php;
    grammarsLoaded.csharp = CS.default ?? CS;
    grammarsLoaded.razor = CS.default ?? CS;
    grammarsLoaded.python = PY.default ?? PY;
  })();
  return grammarsLoading;
}

function queryFileFor(lang: Language): string {
  switch (lang) {
    case "typescript":
    case "tsx":
      return "typescript.scm";
    case "javascript":
    case "jsx":
      return "javascript.scm";
    case "php":
      return "php.scm";
    case "csharp":
    case "razor":
      return "csharp.scm";
    case "python":
      return "python.scm";
  }
}

function loadQuery(lang: Language, language: unknown): Parser.Query {
  const key = lang;
  if (queriesCache[key]) return queriesCache[key]!;
  const file = queryFileFor(lang);
  const src = readFileSync(resolve(__dirname, "queries", file), "utf8");
  const q = new Parser.Query(language as never, src);
  queriesCache[key] = q;
  return q;
}

export interface ParsedSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
  signature?: string;
  isExported?: boolean;
}

export interface ParsedCall {
  callee: string;
  line: number;
  col: number;
  containerSymbol?: string; // qualified name of enclosing fn/method
}

export interface ParsedImport {
  path: string;
  line: number;
}

export interface ParseResult {
  language: Language;
  symbols: ParsedSymbol[];
  calls: ParsedCall[];
  imports: ParsedImport[];
}

const KIND_FROM_CAPTURE: Record<string, string> = {
  function: "function",
  class: "class",
  interface: "interface",
  type: "type",
  enum: "enum",
  method: "method",
  trait: "trait",
  struct: "struct",
  const: "const",
};

function extractRazorCSharp(source: string): string {
  // Strategy B: extract @code { ... } blocks, concat as a single C# file.
  // Preserve approximate line numbers by replacing markup with newlines.
  const lines = source.split("\n");
  const out: string[] = [];
  let inCode = false;
  let depth = 0;
  for (const line of lines) {
    if (!inCode) {
      if (/@code\s*\{/.test(line)) {
        inCode = true;
        depth = (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
        // strip @code and opening brace already on this line; keep content after `{`
        const after = line.replace(/.*@code\s*\{/, "");
        out.push(after);
      } else {
        out.push(""); // keep line number alignment
      }
    } else {
      const opens = (line.match(/\{/g)?.length ?? 0);
      const closes = (line.match(/\}/g)?.length ?? 0);
      depth += opens - closes;
      if (depth <= 0) {
        inCode = false;
        const idx = line.lastIndexOf("}");
        out.push(idx >= 0 ? line.slice(0, idx) : line);
      } else {
        out.push(line);
      }
    }
  }
  // Wrap in a synthetic class so C# parser accepts top-level methods.
  return "class __RazorCode__ {\n" + out.join("\n") + "\n}\n";
}

export async function parseSource(
  filePath: string,
  source: string,
  langOverride?: Language
): Promise<ParseResult | null> {
  const lang = langOverride ?? detectLanguage(filePath);
  if (!lang) return null;
  await loadGrammars();
  const language = grammarsLoaded[lang];
  if (!language) return null;

  let effectiveSource = source;
  if (lang === "razor") {
    effectiveSource = extractRazorCSharp(source);
  }

  const parser = new Parser();
  try {
    parser.setLanguage(language as never);
  } catch (e) {
    return null;
  }
  let tree;
  try {
    tree = parser.parse(effectiveSource);
  } catch {
    return null;
  }

  const query = loadQuery(lang, language);
  const matches = query.matches(tree.rootNode);

  const symbols: ParsedSymbol[] = [];
  const calls: ParsedCall[] = [];
  const imports: ParsedImport[] = [];

  for (const match of matches) {
    const captures = match.captures;
    // Find a *.def or *.site or *.stmt anchor capture
    const defCap = captures.find((c) => c.name.endsWith(".def"));
    const siteCap = captures.find((c) => c.name.endsWith(".site"));
    const stmtCap = captures.find((c) => c.name.endsWith(".stmt"));
    const nameCap = captures.find((c) => c.name.endsWith(".name"));
    const pathCap = captures.find((c) => c.name.endsWith(".path"));

    if (defCap && nameCap) {
      const kindKey = defCap.name.split(".")[0];
      const kind = KIND_FROM_CAPTURE[kindKey] ?? kindKey;
      symbols.push({
        name: nameCap.node.text,
        kind,
        startLine: defCap.node.startPosition.row + 1,
        endLine: defCap.node.endPosition.row + 1,
        startCol: defCap.node.startPosition.column,
        endCol: defCap.node.endPosition.column,
      });
    } else if (siteCap && nameCap) {
      calls.push({
        callee: nameCap.node.text,
        line: siteCap.node.startPosition.row + 1,
        col: siteCap.node.startPosition.column,
      });
    } else if (stmtCap && pathCap) {
      let p = pathCap.node.text;
      // Strip quotes if any
      if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
        p = p.slice(1, -1);
      }
      imports.push({
        path: p,
        line: stmtCap.node.startPosition.row + 1,
      });
    }
  }

  return { language: lang, symbols, calls, imports };
}
