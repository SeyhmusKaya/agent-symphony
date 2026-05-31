import type { CreateSpecialistInput, Effort, SpecialistDef } from "./registry.js";

// Claude Code uyumlu ajan .md formati:
//   ---
//   name: kod-inceleme
//   role: kod incelemesi
//   model: claude-opus-4-8[1m]
//   effort: medium
//   tools: Read, Grep, Bash
//   ---
//   <sistem promptu govdesi>

export interface Frontmatter {
  body: string;
  fields: Record<string, string>;
}

export function parseFrontmatter(text: string): Frontmatter {
  const t = text.replace(/^﻿/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(t);
  if (!m) return { body: t.trim(), fields: {} };
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    if (key) fields[key] = line.slice(idx + 1).trim();
  }
  return { body: m[2].trim(), fields };
}

function asEffort(v: string | undefined): Effort | undefined {
  return v === "low" || v === "medium" || v === "high" ? v : undefined;
}

export function specialistToMarkdown(def: SpecialistDef): string {
  const lines = [
    "---",
    `name: ${def.name}`,
    `role: ${def.role}`,
    `model: ${def.model}`,
    `effort: ${def.effort}`,
    `tools: ${def.allowedTools.join(", ")}`,
    "---",
    "",
    def.systemPrompt,
  ];
  return lines.join("\n");
}

export function markdownToSpecialist(text: string): CreateSpecialistInput {
  const { body, fields } = parseFrontmatter(text);
  const name = fields.name;
  if (!name) throw new Error("Frontmatter'da 'name' alani zorunlu.");
  if (!body) throw new Error("Sistem promptu govdesi bos.");
  const tools = (fields.tools ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    name,
    role: fields.role ?? name,
    systemPrompt: body,
    allowedTools: tools.length ? tools : undefined,
    model: fields.model || undefined,
    effort: asEffort(fields.effort),
  };
}
