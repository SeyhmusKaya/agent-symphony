// orchestrator/repoCatalog.ts — shared ecosystem GitHub tool/repo catalog.
// Global (appDataDir/tool-catalog.json) — the Architect + all chiefs + advisors
// read/write the same file. Same pattern as NoteStore (atomic write, fresh read).
//
// Purpose (user request): a "Tools menu" — discovered/recommended GitHub tools
// should be stored along with what they do; all agents access them via
// tool_catalog_search/list; added via tool_catalog_add when "save" is said
// during the nightly scan + in chat.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type RepoSource = "manual" | "daily-report" | "chat";

export interface RepoTool {
  id: string;
  name: string; // "Skyvern"
  url: string; // https://github.com/...
  purpose: string; // what it is for (1-3 sentences)
  category?: string; // "browser-automation" | "scraping" | ...
  tags: string[];
  addedBy: string; // "Mimar" | chief name | "gece-tarama"
  source: RepoSource;
  createdAt: number;
  updatedAt: number;
}

export interface RepoToolInput {
  name: string;
  url: string;
  purpose: string;
  category?: string;
  tags?: string[];
  addedBy?: string;
  source?: RepoSource;
}

// Normalize the URL — so the same repo is not added twice (trailing slash, .git, case).
function normalizeUrl(url: string): string {
  return url
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export class RepoCatalogStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  // Reads fresh from disk on every operation — the UI (Tauri) and orchestrator write the same file.
  private read(): RepoTool[] {
    if (!existsSync(this.filePath)) return [];
    const raw = readFileSync(this.filePath, "utf8").trim();
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as RepoTool[];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  // Atomic write — temp file + rename, prevents a partial write.
  private write(items: RepoTool[]): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(items, null, 2), "utf8");
    renameSync(tmp, this.filePath);
  }

  list(): RepoTool[] {
    return this.read().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // UPDATES if the URL is the same (purpose/tags/category refreshed), otherwise ADDS.
  // Idempotent — the same repo is not recorded twice.
  add(input: RepoToolInput): RepoTool {
    const now = Date.now();
    const items = this.read();
    const norm = normalizeUrl(input.url);
    const existing = items.find((r) => normalizeUrl(r.url) === norm);
    if (existing) {
      existing.name = input.name || existing.name;
      existing.purpose = input.purpose || existing.purpose;
      if (input.category !== undefined) existing.category = input.category;
      if (input.tags !== undefined) existing.tags = input.tags;
      if (input.addedBy) existing.addedBy = input.addedBy;
      if (input.source) existing.source = input.source;
      existing.updatedAt = now;
      this.write(items);
      return existing;
    }
    const tool: RepoTool = {
      id: randomUUID(),
      name: input.name,
      url: input.url.trim().replace(/\.git$/i, "").replace(/\/+$/, ""),
      purpose: input.purpose,
      category: input.category,
      tags: input.tags ?? [],
      addedBy: input.addedBy ?? "Mimar",
      source: input.source ?? "manual",
      createdAt: now,
      updatedAt: now,
    };
    items.push(tool);
    this.write(items);
    return tool;
  }

  update(
    id: string,
    patch: Partial<Pick<RepoTool, "name" | "url" | "purpose" | "category" | "tags">>,
  ): RepoTool | null {
    const items = this.read();
    const r = items.find((x) => x.id === id);
    if (!r) return null;
    if (patch.name !== undefined) r.name = patch.name;
    if (patch.url !== undefined) r.url = patch.url;
    if (patch.purpose !== undefined) r.purpose = patch.purpose;
    if (patch.category !== undefined) r.category = patch.category;
    if (patch.tags !== undefined) r.tags = patch.tags;
    r.updatedAt = Date.now();
    this.write(items);
    return r;
  }

  remove(id: string): boolean {
    const items = this.read();
    const kept = items.filter((r) => r.id !== id);
    if (kept.length === items.length) return false;
    this.write(kept);
    return true;
  }

  // Keyword search: name / purpose / category / tag / url.
  search(query: string): RepoTool[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list();
    return this.list().filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.purpose.toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q) ||
        r.url.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }
}
