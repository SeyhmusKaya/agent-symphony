import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./agentmd.js";

export type SlashKind = "builtin" | "custom" | "none";

export interface ParsedSlash {
  kind: SlashKind;
  name: string;
  args: string;
  body?: string;
  description?: string;
}

export const BUILTIN_SLASH = ["compact", "clear", "reflect"];

export function parseSlash(input: string, commandsDir: string): ParsedSlash {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { kind: "none", name: "", args: "" };
  }
  const space = trimmed.indexOf(" ");
  const name = (space === -1 ? trimmed.slice(1) : trimmed.slice(1, space)).toLowerCase();
  const args = space === -1 ? "" : trimmed.slice(space + 1).trim();

  if (BUILTIN_SLASH.includes(name)) {
    return { kind: "builtin", name, args };
  }

  const file = join(commandsDir, `${name}.md`);
  if (existsSync(file)) {
    const { body, fields } = parseFrontmatter(readFileSync(file, "utf8"));
    return { kind: "custom", name, args, body, description: fields.description };
  }

  return { kind: "none", name, args };
}
