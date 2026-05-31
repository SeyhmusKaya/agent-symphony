import { extname } from "node:path";

// Fix 92: document index — not tree-sitter, based on lightweight regex/JSON.parse.
// Separate table + separate tool so it doesn't pollute the existing symbol graph.

export type DocType = "md" | "json" | "yaml" | "toml" | "txt";

export interface DocChunk {
  kind: "heading" | "key" | "paragraph" | "root";
  title: string;
  level: number;
  lineStart: number;
  lineEnd: number;
  body: string;
}

const EXT_TO_TYPE: Record<string, DocType> = {
  ".md": "md",
  ".mdx": "md",
  ".markdown": "md",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".txt": "txt",
  ".rst": "txt",
};

const SKIP_PATTERNS: RegExp[] = [
  /\.min\.json$/i,
  /\.lock$/i,
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /poetry\.lock$/i,
  /composer\.lock$/i,
];

export function detectDocType(filePath: string): DocType | null {
  const lower = filePath.toLowerCase();
  for (const pat of SKIP_PATTERNS) {
    if (pat.test(lower)) return null;
  }
  const ext = extname(lower);
  return EXT_TO_TYPE[ext] ?? null;
}

export function parseDoc(filePath: string, src: string): DocChunk[] | null {
  const t = detectDocType(filePath);
  if (!t) return null;
  switch (t) {
    case "md":   return parseMarkdown(src);
    case "json": return parseJsonDoc(src);
    case "yaml": return parseYaml(src);
    case "toml": return parseToml(src);
    case "txt":  return parseTxt(src);
  }
}

// --- Markdown ---------------------------------------------------------------

function parseMarkdown(src: string): DocChunk[] {
  const lines = src.split(/\r?\n/);
  const chunks: DocChunk[] = [];
  let curTitle = "(intro)";
  let curLevel = 0;
  let curStart = 1;
  let buf: string[] = [];
  let inCode = false;

  const flush = (endLine: number) => {
    const body = buf.join("\n").trim();
    if (body.length > 0 || curTitle !== "(intro)") {
      chunks.push({
        kind: curTitle === "(intro)" ? "paragraph" : "heading",
        title: curTitle,
        level: curLevel,
        lineStart: curStart,
        lineEnd: endLine,
        body: body.slice(0, 4000),
      });
    }
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    // Skip code fence content for heading detection
    if (/^```/.test(ln)) {
      inCode = !inCode;
      buf.push(ln);
      continue;
    }
    if (!inCode) {
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(ln);
      if (m) {
        flush(i);
        curTitle = m[2].trim();
        curLevel = m[1].length;
        curStart = i + 1;
        continue;
      }
    }
    buf.push(ln);
  }
  flush(lines.length);
  return chunks;
}

// --- JSON -------------------------------------------------------------------

function parseJsonDoc(src: string): DocChunk[] {
  const chunks: DocChunk[] = [];
  // Allow JSONC: strip // and /* */ comments before parse, but record lines from original.
  let parsed: unknown;
  try {
    const stripped = stripJsonComments(src);
    parsed = JSON.parse(stripped);
  } catch {
    // Fallback: index full doc as single chunk so FTS still finds keywords.
    chunks.push({
      kind: "root",
      title: "(json-parse-failed)",
      level: 0,
      lineStart: 1,
      lineEnd: src.split(/\r?\n/).length,
      body: src.slice(0, 4000),
    });
    return chunks;
  }
  if (parsed === null || typeof parsed !== "object") {
    chunks.push({
      kind: "root",
      title: "(scalar)",
      level: 0,
      lineStart: 1,
      lineEnd: 1,
      body: String(parsed).slice(0, 4000),
    });
    return chunks;
  }

  const obj = parsed as Record<string, unknown>;
  const lineMap = buildJsonLineMap(src, Object.keys(obj));
  const isArray = Array.isArray(parsed);
  if (isArray) {
    chunks.push({
      kind: "root",
      title: "(array)",
      level: 0,
      lineStart: 1,
      lineEnd: src.split(/\r?\n/).length,
      body: JSON.stringify(parsed).slice(0, 4000),
    });
    return chunks;
  }

  // Top-level keys → one chunk each.
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const valStr = typeof v === "object" && v !== null
      ? JSON.stringify(v, null, 2)
      : String(v);
    const ln = lineMap.get(k) ?? 1;
    chunks.push({
      kind: "key",
      title: k,
      level: 1,
      lineStart: ln,
      lineEnd: ln,
      body: valStr.slice(0, 4000),
    });
    // Nested objects: 2nd-level keys as separate chunks (path = "parent.child").
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const nk of Object.keys(v as Record<string, unknown>)) {
        const nv = (v as Record<string, unknown>)[nk];
        const nvStr = typeof nv === "object" && nv !== null
          ? JSON.stringify(nv)
          : String(nv);
        chunks.push({
          kind: "key",
          title: `${k}.${nk}`,
          level: 2,
          lineStart: ln,
          lineEnd: ln,
          body: nvStr.slice(0, 4000),
        });
      }
    }
  }
  return chunks;
}

function stripJsonComments(src: string): string {
  // // line comments and /* */ block comments. Skip within strings.
  let out = "";
  let i = 0;
  let inStr = false;
  let strCh = "";
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === "\\" && i + 1 < src.length) { out += src[i + 1]; i += 2; continue; }
      if (c === strCh) inStr = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true; strCh = c; out += c; i++; continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function buildJsonLineMap(src: string, keys: string[]): Map<string, number> {
  const map = new Map<string, number>();
  const lines = src.split(/\r?\n/);
  const keySet = new Set(keys);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const m = /^\s*"([^"]+)"\s*:/.exec(ln);
    if (m && keySet.has(m[1]) && !map.has(m[1])) {
      map.set(m[1], i + 1);
    }
  }
  return map;
}

// --- YAML -------------------------------------------------------------------

function parseYaml(src: string): DocChunk[] {
  const lines = src.split(/\r?\n/);
  const chunks: DocChunk[] = [];
  // Top-level key: zero indent + "key:" pattern.
  let curKey: string | null = null;
  let curStart = 1;
  let buf: string[] = [];

  const flush = (endLine: number) => {
    if (curKey !== null) {
      chunks.push({
        kind: "key",
        title: curKey,
        level: 1,
        lineStart: curStart,
        lineEnd: endLine,
        body: buf.join("\n").trim().slice(0, 4000),
      });
    }
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*#/.test(ln) || /^\s*$/.test(ln)) {
      buf.push(ln);
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:/.exec(ln);
    if (m) {
      flush(i);
      curKey = m[1];
      curStart = i + 1;
      buf.push(ln);
    } else {
      buf.push(ln);
    }
  }
  flush(lines.length);
  return chunks;
}

// --- TOML -------------------------------------------------------------------

function parseToml(src: string): DocChunk[] {
  const lines = src.split(/\r?\n/);
  const chunks: DocChunk[] = [];
  let curSection = "(root)";
  let curStart = 1;
  let buf: string[] = [];

  const flush = (endLine: number) => {
    chunks.push({
      kind: "key",
      title: curSection,
      level: curSection === "(root)" ? 0 : 1,
      lineStart: curStart,
      lineEnd: endLine,
      body: buf.join("\n").trim().slice(0, 4000),
    });
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const m = /^\s*\[([^\]]+)\]\s*$/.exec(ln);
    if (m) {
      flush(i);
      curSection = m[1].trim();
      curStart = i + 1;
      continue;
    }
    buf.push(ln);
  }
  flush(lines.length);
  return chunks.filter((c) => c.body.length > 0 || c.title !== "(root)");
}

// --- TXT --------------------------------------------------------------------

function parseTxt(src: string): DocChunk[] {
  const lines = src.split(/\r?\n/);
  return [{
    kind: "root",
    title: "(text)",
    level: 0,
    lineStart: 1,
    lineEnd: lines.length,
    body: src.slice(0, 4000),
  }];
}
