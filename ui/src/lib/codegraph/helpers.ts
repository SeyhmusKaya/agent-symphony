// ui/src/lib/codegraph/helpers.ts — CodeGraphScreen pure formatters + kind/
// language constant maps. Shared by StatsPanel and the upcoming sub-components.

export function fmtNum(n: number): string {
  return new Intl.NumberFormat("en").format(n);
}

export function fmtDate(ts: number | null): string {
  if (!ts) return "never indexed";
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

export function fmtAgo(ts: number | null): string {
  if (!ts) return "—";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// Symbol types — kind label + color maps. Used in search result card badges,
// kind chip filter buttons, and the detail panel.
export const KIND_LABEL: Record<string, string> = {
  function: "Function",
  method: "Method",
  class: "Class",
  interface: "Interface",
  type: "Type",
  variable: "Variable",
  constant: "Constant",
  const: "Constant",
  var: "Variable",
  module: "Module",
  enum: "Enum",
  component: "Component",
  trait: "Trait",
  struct: "Struct",
  impl: "Impl",
};

export const KIND_COLOR: Record<string, string> = {
  function: "#0F766E",
  method: "#0891B2",
  class: "#A21CAF",
  interface: "#7C3AED",
  type: "#B45309",
  variable: "#475569",
  constant: "#0369A1",
  const: "#0369A1",
  var: "#475569",
  module: "#525252",
  enum: "#BE185D",
  component: "#9333EA",
  trait: "#0F766E",
  struct: "#7C3AED",
  impl: "#059669",
};

export function kindBg(k: string): string {
  return (KIND_COLOR[k] ?? "#475569") + "1A";
}

export function kindFg(k: string): string {
  return KIND_COLOR[k] ?? "#475569";
}

export function kindLabel(k: string): string {
  return KIND_LABEL[k] ?? k;
}

export const LANG_LABEL: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  php: "PHP",
  csharp: "C#",
  python: "Python",
  razor: "Razor",
};

export const LANG_COLOR: Record<string, string> = {
  typescript: "#3178C6",
  javascript: "#F7DF1E",
  php: "#777BB4",
  csharp: "#239120",
  python: "#3776AB",
  razor: "#512BD4",
};

// Also expose Stats / RelatedSymbol / CgSymbol / ImportsData types for external
// import from here — so sub-components share a common type.
export interface Stats {
  files: number;
  symbols: number;
  edges: number;
  languages?: Record<string, number>;
  kinds?: Record<string, number>;
  projectName: string;
  projectRoot: string;
  lastFullIndex: number | null;
  building: boolean;
  ready: boolean;
}

export interface CgSymbol {
  id: number;
  name: string;
  qname: string;
  kind: string;
  startLine: number;
  endLine: number;
  signature: string | null;
  isExported: boolean;
  path: string;
}

export interface RelatedSymbol {
  name: string;
  qname: string;
  kind: string;
  startLine?: number;
}

export interface ImportsData {
  inbound: string[];
  outbound: string[];
}
