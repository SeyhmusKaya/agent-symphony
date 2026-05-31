// orchestrator/skills.ts — F2 (master plan section 3 F2): per-role skill loader.
//
// Skill = an Anthropic SDK concept: a SKILL.md frontmatter + optional example
// files. The SDK picks them up in two ways:
//   1) AgentDefinition.skills?: string[] — name-based loading into subagent context.
//   2) ClaudeAgentOptions.skills?: string[] | "all" — main session filter
//      (requires an fs scan together with settingSources).
//
// Architect keeps them separately by role in its own directory — a Mimar
// specialist's skill should not load into the chief, sef-volpora's laravel skill
// should not go to sef-orbitwar. Layout:
//   ~/.architect/skills/
//     global/                <-- loaded for every role
//     mimar/                 <-- only Mimar
//     advisor-<key>/         <-- the relevant advisor (seo|finans|...)
//     sef-<projectId>/       <-- the relevant project chief
//
// SKILL.md format (Anthropic standard):
//   ---
//   name: typescript-master
//   description: TypeScript advanced helper
//   ---
//   <body>
//
// This module reads fs synchronously; skill load happens once per session, not
// per-turn. We are not on the hot path, so async overhead is unnecessary.

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  body: string;
  // Absolute path to SKILL.md — for UI actions like "open source".
  path: string;
  // Which role folder it came from (global / mimar / advisor-<key> / sef-<id>).
  role: string;
}

export interface SkillRoleEntry {
  role: string;
  skills: Skill[];
}

/** Architect skill root directory. ~/.architect/skills/.
 *  ARCHITECT_SKILLS_ROOT env can override it for the test environment. */
export function skillsRootDir(): string {
  const override = process.env.ARCHITECT_SKILLS_ROOT;
  if (override && override.trim()) return override.trim();
  return join(homedir(), ".architect", "skills");
}

/** Folder path of a specific role. Does not create it; check with existsSync. */
export function skillRoleDir(role: string): string {
  return join(skillsRootDir(), sanitizeRole(role));
}

/**
 * Reduces the role name to safe filesystem characters. Fail-fast on
 * empty / illegal-character injection. The role param comes from the Architect
 * in a tool call and is written directly into the folder name.
 */
function sanitizeRole(role: string): string {
  const trimmed = String(role ?? "").trim();
  if (!trimmed) throw new Error("Role cannot be empty");
  // Anthropic agent name pattern + underscore/hyphen. .. / \ are blocked.
  if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new Error(`Role contains an invalid character: ${trimmed}`);
  }
  return trimmed;
}

/** Parse SKILL.md frontmatter. name + description; produces a default if missing. */
function parseSkillMd(raw: string, fallbackName: string): { name: string; description: string; body: string } {
  // Frontmatter block: wrapped with --- at the start of the file. We read a
  // minimal YAML subset: key: value. We do not support multi-line values; simplicity wins.
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) {
    return { name: fallbackName, description: "", body: raw };
  }
  const fmBlock = m[1];
  const body = m[2] ?? "";
  let name = fallbackName;
  let description = "";
  for (const line of fmBlock.split(/\r?\n/)) {
    const kv = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].trim().replace(/^["']|["']$/g, "");
    if (key === "name") name = value || fallbackName;
    else if (key === "description") description = value;
  }
  return { name, description, body };
}

/**
 * Reads all SKILL.md files in a role folder. Returns an empty array if the
 * folder does not exist — SAFE FALLBACK, never throws.
 */
export function loadSkills(role: string): Skill[] {
  const safeRole = sanitizeRole(role);
  const dir = join(skillsRootDir(), safeRole);
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const entry of entries) {
    const sub = join(dir, entry);
    let st;
    try {
      st = statSync(sub);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const skillFile = join(sub, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    let raw: string;
    try {
      raw = readFileSync(skillFile, "utf8");
    } catch {
      continue;
    }
    const parsed = parseSkillMd(raw, entry);
    out.push({
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      path: skillFile,
      role: safeRole,
    });
  }
  return out;
}

/** The global skill set — loaded for every role. */
export function loadGlobalSkills(): Skill[] {
  return loadSkills("global");
}

/**
 * The effective skill list for a role = global + role-specific.
 * To send a name list to AgentDefinition.skills or the main session
 * options.skills: this.map(s => s.name).
 */
export function loadEffectiveSkills(role: string): Skill[] {
  const safeRole = sanitizeRole(role);
  if (safeRole === "global") return loadGlobalSkills();
  return [...loadGlobalSkills(), ...loadSkills(safeRole)];
}

/**
 * Scans all role folders. The UI SkillManager fetches this in one go and
 * shows tabs/groups.
 */
export function listSkillRoles(): SkillRoleEntry[] {
  const root = skillsRootDir();
  if (!existsSync(root)) return [];
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return [];
  }
  const out: SkillRoleEntry[] = [];
  for (const d of dirs) {
    let st;
    try {
      st = statSync(join(root, d));
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    // sanitize: silently skip invalid role folders.
    try {
      sanitizeRole(d);
    } catch {
      continue;
    }
    out.push({ role: d, skills: loadSkills(d) });
  }
  return out;
}

/**
 * Copies an external skill into a role folder.
 * - if sourcePath is given: either a SKILL.md file or a folder containing a
 *   SKILL.md. If a folder, only SKILL.md is copied (simple behavior; example
 *   files later).
 * - if sourcePath is not given: only an empty skeleton (skill directory +
 *   SKILL.md placeholder) is created — the Architect fills it in later via Edit.
 */
export function attachSkill(role: string, skillName: string, sourcePath?: string): Skill {
  const safeRole = sanitizeRole(role);
  if (!skillName || !/^[A-Za-z0-9_.-]+$/.test(skillName)) {
    throw new Error(`Skill name is invalid: ${skillName}`);
  }
  const roleDir = join(skillsRootDir(), safeRole);
  const skillDir = join(roleDir, skillName);
  mkdirSync(skillDir, { recursive: true });
  const targetMd = join(skillDir, "SKILL.md");

  let content: string;
  if (sourcePath && existsSync(sourcePath)) {
    const stat = statSync(sourcePath);
    let srcMd: string | undefined;
    if (stat.isDirectory()) {
      const inner = join(sourcePath, "SKILL.md");
      if (existsSync(inner)) srcMd = inner;
    } else if (sourcePath.toLowerCase().endsWith(".md")) {
      srcMd = sourcePath;
    }
    if (!srcMd) {
      throw new Error(`Source SKILL.md not found: ${sourcePath}`);
    }
    copyFileSync(srcMd, targetMd);
    content = readFileSync(targetMd, "utf8");
  } else {
    // Skeleton — the Architect/specialist fills it in later via Edit.
    content = `---\nname: ${skillName}\ndescription: ${skillName} skill (skeleton - needs to be filled in)\n---\n\n# ${skillName}\n\nNo content written yet.\n`;
    writeFileSync(targetMd, content, "utf8");
  }
  const parsed = parseSkillMd(content, skillName);
  return {
    name: parsed.name,
    description: parsed.description,
    body: parsed.body,
    path: targetMd,
    role: safeRole,
  };
}

/**
 * Deletes the skill folder for a role/skill pair. SAFE: no-op if it does not exist.
 * sanitizeRole + the skillName regex prevent path injection outside the skill root.
 */
export function detachSkill(role: string, skillName: string): void {
  const safeRole = sanitizeRole(role);
  if (!skillName || !/^[A-Za-z0-9_.-]+$/.test(skillName)) {
    throw new Error(`Skill name is invalid: ${skillName}`);
  }
  const skillDir = join(skillsRootDir(), safeRole, skillName);
  if (!existsSync(skillDir)) return;
  rmSync(skillDir, { recursive: true, force: true });
}

/** Create the role-based folder (if absent). For the UI "new role" flow. */
export function ensureRoleDir(role: string): string {
  const safeRole = sanitizeRole(role);
  const dir = join(skillsRootDir(), safeRole);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Returns only the skill name list for the given role — passed directly to the
 * SDK AgentDefinition.skills or options.skills field.
 * Global skills are included too (loadEffectiveSkills).
 */
export function effectiveSkillNames(role: string): string[] {
  return loadEffectiveSkills(role).map((s) => s.name);
}

/**
 * Formats the skill list as a system-prompt block. Does NOT TRUST SDK skill
 * discovery — because settingSources=[] + skills live in ~/.architect/skills/,
 * the SDK could not resolve the AgentDefinition.skills / options.skills name
 * list (the content was not loaded). Solution: inject the skill BODY directly
 * into the prompt. This method is discovery/path independent and works reliably.
 * The block is fixed for the whole session → the cache prefix is not broken
 * (skills do not change mid-turn).
 */
function formatSkillBlock(skills: Skill[]): string {
  if (!skills.length) return "";
  const parts = skills.map((s) => {
    const head = `### ${s.name}${s.description ? " — " + s.description : ""}`;
    return `${head}\n${s.body}`.trim();
  });
  return (
    "\n\n## LOADED EXPERTISE SKILLS (guide — follow these in tasks)\n\n" +
    parts.join("\n\n---\n\n")
  );
}

/** Returns the effective skill bodies for a role (global|mimar|advisor-<key>|sef-<id>)
 *  as a prompt block. Added to the main session (advisor/sef/mimar) systemPrompt.
 *  SAFE: empty string if the folder does not exist. */
export function buildSkillPromptBlock(role: string): string {
  let skills: Skill[];
  try {
    skills = loadEffectiveSkills(role);
  } catch {
    return "";
  }
  return formatSkillBlock(skills);
}

/** Searches the given skill NAMES across all role folders, returns the bodies
 *  of matches as a prompt block. For specialist (subagent) spec.skills names —
 *  since the specialist has no role folder of its own, name->body is resolved via a global scan. */
export function buildSkillPromptBlockFromNames(names: string[]): string {
  if (!Array.isArray(names) || names.length === 0) return "";
  const want = new Set(names);
  const seen = new Set<string>();
  const out: Skill[] = [];
  for (const entry of listSkillRoles()) {
    for (const s of entry.skills) {
      if (want.has(s.name) && !seen.has(s.name)) {
        seen.add(s.name);
        out.push(s);
      }
    }
  }
  return formatSkillBlock(out);
}

/** Compact shape for the UI status payload — body is long, not sent. */
export function listSkillRolesCompact(): Array<{
  role: string;
  skills: Array<{ name: string; description: string; path: string }>;
}> {
  return listSkillRoles().map((r) => ({
    role: r.role,
    skills: r.skills.map((s) => ({ name: s.name, description: s.description, path: s.path })),
  }));
}

