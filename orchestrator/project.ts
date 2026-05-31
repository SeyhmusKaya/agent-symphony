import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export interface TeamPaths {
  root: string;
  team: string;
  config: string;
  agents: string;
  queue: string;
  chief: string;
  sessions: string;
  commands: string;
  skills: string;
}

export function teamPaths(projectRoot: string, teamOverride?: string): TeamPaths {
  const team = teamOverride ?? join(projectRoot, ".team");
  return {
    root: projectRoot,
    team,
    config: join(team, "config.json"),
    agents: join(team, "agents.json"),
    queue: join(team, "queue.json"),
    chief: join(team, "chief.json"),
    sessions: join(team, "sessions"),
    commands: join(team, "commands"),
    skills: join(team, "skills"),
  };
}

export function ensureTeam(projectRoot: string, teamOverride?: string): TeamPaths {
  const p = teamPaths(projectRoot, teamOverride);
  for (const dir of [p.team, p.sessions, p.commands, p.skills]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return p;
}

interface ChiefState {
  sessionId: string | null;
  // M5: kullanicinin load_toolset ile actigi gruplar sef oturumlari arasi
  // kalir. Restart sonrasi yine ayni gruplar acik gelir.
  loadedToolsets?: string[];
  // M2: clearSessionId cagrildiginda sebebini buraya yazariz. Bir sonraki
  // resume reddedilirse main.ts bu sebebi chatLog'a "neden" olarak dusurur.
  lastClearReason?: string | null;
  lastClearTs?: number;
}

export class ChiefStore {
  private filePath: string;
  private state: ChiefState = {
    sessionId: null,
    loadedToolsets: [],
    lastClearReason: null,
    lastClearTs: 0,
  };

  constructor(filePath: string) {
    this.filePath = filePath;
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8").trim();
      if (raw) {
        const parsed = JSON.parse(raw) as ChiefState;
        this.state = {
          sessionId: parsed.sessionId ?? null,
          loadedToolsets: parsed.loadedToolsets ?? [],
          lastClearReason: parsed.lastClearReason ?? null,
          lastClearTs: parsed.lastClearTs ?? 0,
        };
      }
    }
  }

  getSessionId(): string | null {
    return this.state.sessionId;
  }

  setSessionId(id: string): void {
    this.state.sessionId = id;
    this.persist();
  }

  clearSessionId(reason: string = "bilinmiyor"): void {
    this.state.sessionId = null;
    this.state.lastClearReason = reason;
    this.state.lastClearTs = Date.now();
    this.persist();
  }

  getLastClearReason(): { reason: string | null; ts: number } {
    return {
      reason: this.state.lastClearReason ?? null,
      ts: this.state.lastClearTs ?? 0,
    };
  }

  getLoadedToolsets(): string[] {
    return [...(this.state.loadedToolsets ?? [])];
  }

  addLoadedToolsets(groups: string[]): string[] {
    const cur = new Set(this.state.loadedToolsets ?? []);
    for (const g of groups) cur.add(g);
    this.state.loadedToolsets = [...cur];
    this.persist();
    return [...cur];
  }

  removeLoadedToolsets(groups: string[]): string[] {
    const cur = new Set(this.state.loadedToolsets ?? []);
    for (const g of groups) cur.delete(g);
    this.state.loadedToolsets = [...cur];
    this.persist();
    return [...cur];
  }

  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }
}

export interface ProjectDeployment {
  mode: "local" | "remote" | "hibrit";
  serverIds: string[];
  deployScript?: string;
  publicUrl?: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
  logoUri?: string;
  deployment?: ProjectDeployment;
}

export class ProjectStore {
  private filePath: string;
  private projects: ProjectEntry[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8").trim();
      if (raw) this.projects = JSON.parse(raw) as ProjectEntry[];
    }
  }

  list(): ProjectEntry[] {
    return [...this.projects].sort((a, b) => b.lastOpened - a.lastOpened);
  }

  add(name: string, path: string): ProjectEntry {
    const existing = this.projects.find((p) => p.path === path);
    if (existing) {
      existing.lastOpened = Date.now();
      this.save();
      return existing;
    }
    const entry: ProjectEntry = {
      id: randomUUID(),
      name,
      path,
      lastOpened: Date.now(),
    };
    this.projects.push(entry);
    this.save();
    return entry;
  }

  touch(id: string): void {
    const p = this.projects.find((x) => x.id === id);
    if (p) {
      p.lastOpened = Date.now();
      this.save();
    }
  }

  remove(id: string): ProjectEntry | undefined {
    const idx = this.projects.findIndex((p) => p.id === id);
    if (idx < 0) return undefined;
    const [removed] = this.projects.splice(idx, 1);
    this.save();
    return removed;
  }

  // Fix 80: talk_to_chief spawn_fail engelle. Disk'te artik bulunmayan proje
  // path'lerini projects.json'dan ay. Mimar startup'ta calistirir — boylece
  // resolveProject() stale id'yi cozmez ve crosschief.ts spawn etmez.
  // Silmeden once projects.json yaninda .bak yaz, ayni dizinde audit log
  // tutulsun (caller logger ile yazsin).
  pruneStale(): ProjectEntry[] {
    const stale: ProjectEntry[] = [];
    const alive: ProjectEntry[] = [];
    for (const p of this.projects) {
      if (p.path && existsSync(p.path)) {
        alive.push(p);
      } else {
        stale.push(p);
      }
    }
    if (stale.length === 0) return [];
    // Backup once before mutating.
    try {
      if (existsSync(this.filePath)) {
        const bakPath = this.filePath + ".bak";
        writeFileSync(bakPath, readFileSync(this.filePath, "utf8"), "utf8");
      }
    } catch {
      /* yedek alinamadi — yine de devam et, asil mantik veri kaybi yapmiyor */
    }
    this.projects = alive;
    this.save();
    return stale;
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.projects, null, 2), "utf8");
  }
}
