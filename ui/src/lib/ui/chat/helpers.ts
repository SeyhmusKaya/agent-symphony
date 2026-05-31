// ui/src/lib/ui/chat/helpers.ts — pure helpers for ChatThread.
// fmt functions + tool batch grouping + Item discriminated union.
// ChatThread.svelte and its sub-components import from here.

import { fmtTime as fmtTimeTr } from "$lib/time";
import type { ChatSegment, ToolActivity } from "$lib/store.svelte";

// Fix 106: PAGE 200 -> 30. In long chats (4h+, 100+ messages) the DOM blew up;
// typing in the composer ran autoGrow + Svelte reactivity that laid out the
// whole thread on every keystroke (500ms+ freeze). 30 latest messages on
// initial render; when the user scrolls up "Load older" adds 30 more. No hard
// ceiling — once scrolled back to the bottom of scrollEl the cap drops to PAGE.
export const PAGE = 30;

export function fmtTime(ts: number): string {
  return fmtTimeTr(ts);
}

// Single-shot formatter (used in the Architect/chief cost line tag breakdown).
export function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

// Tool batch summary — like "Read 2 files" in Claude Code.
// If there is a single tool, its name; if the same names repeat, "Read 3 files".
export function batchLabel(tools: { ad: string }[]): string {
  if (tools.length === 0) return "tool";
  if (tools.length === 1) return tools[0].ad;
  const adlar = new Set(tools.map((t) => t.ad));
  if (adlar.size === 1) return `${tools[0].ad} ${tools.length} times`;
  return `${tools.length} tools`;
}

// Fix 56: short token format — 1234 -> "1.2k", 12k -> "12k", 1.2M -> "1.2M"
export function fmtTokenShort(n: number): string {
  if (!n || n < 0) return "0";
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}

// Fix 65: per-tool badge "0↓" is misleading. Even if dUncached=0, cache_read in
// the round represents a prompt of thousands of tokens. Show the TOTAL prompt
// size in the badge.
export function toolTotalIn(k?: { in?: number; cacheRead?: number; cacheCreate?: number }): number {
  if (!k) return 0;
  return (k.in ?? 0) + (k.cacheRead ?? 0) + (k.cacheCreate ?? 0);
}

// Tool input snippet — a hint like "Read C:/.../foo.ts" without flooding the UI.
export function snip(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 70 ? t.slice(0, 70) + "…" : t;
}

// Inline render pieces: walks a chief message's segments array in order and
// collapses consecutive same-named tool runs (3+) into a single "group". A
// single tool or 2 consecutive tools → individual cards. Text segments pass
// through as-is. This preserves the Claude Code style: text and tools in real
// order, without a "83 tools" pile.
export type Item =
  | { kind: "text"; text: string; segIdx: number }
  | { kind: "tool"; tool: ToolActivity; segIdx: number; tIdx: number }
  | { kind: "group"; tools: ToolActivity[]; segIdx: number; tIdx: number };

export function buildItems(segs: ChatSegment[]): Item[] {
  const out: Item[] = [];
  segs.forEach((seg, si) => {
    if (seg.kind === "text") {
      if (seg.text.trim() !== "") out.push({ kind: "text", text: seg.text, segIdx: si });
      return;
    }
    // tools segment — find consecutive same-name runs.
    const tools = seg.tools;
    let i = 0;
    while (i < tools.length) {
      let j = i + 1;
      while (j < tools.length && tools[j].ad === tools[i].ad) j++;
      const run = tools.slice(i, j);
      if (run.length >= 3) {
        out.push({ kind: "group", tools: run, segIdx: si, tIdx: i });
      } else {
        run.forEach((t, k) =>
          out.push({ kind: "tool", tool: t, segIdx: si, tIdx: i + k }),
        );
      }
      i = j;
    }
  });
  return out;
}
