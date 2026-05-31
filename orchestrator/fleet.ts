import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore, type ProjectEntry } from "./project.js";

export const GLOBAL_ID = "__global__";

/** Architect deposunun kok dizini (orchestrator/'in ust dizini). */
export function repoRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/** Mimar'in durum dizini — repo ile cakismaz, appData altinda. */
export function globalTeamDir(): string {
  return join(appDataDir(), "global", ".team");
}

/** Indirilen eklentilerin tutuldugu dizin. */
export function pluginsDir(): string {
  return join(appDataDir(), "plugins");
}

/** Tum orkestratorlarda varsayilan yuklenecek eklentiler (varsa). */
export function defaultPluginPaths(): string[] {
  const sp = join(pluginsDir(), "superpowers");
  return existsSync(sp) ? [sp] : [];
}

export function appDataDir(): string {
  const base = process.env.APPDATA ?? join(process.env.HOME ?? ".", ".config");
  return join(base, "com.seyh.architect");
}

export function projectsFile(): string {
  return join(appDataDir(), "projects.json");
}

function runningFile(): string {
  return join(appDataDir(), "running.json");
}

export interface RunningEntry {
  projectId: string;
  port: number;
  pid: number;
  name: string;
  path: string;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class Fleet {
  private file = runningFile();

  private read(): RunningEntry[] {
    if (!existsSync(this.file)) return [];
    try {
      const raw = readFileSync(this.file, "utf8").trim();
      return raw ? (JSON.parse(raw) as RunningEntry[]) : [];
    } catch {
      return [];
    }
  }

  private write(list: RunningEntry[]): void {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(list, null, 2), "utf8");
  }

  list(): RunningEntry[] {
    return this.read().filter((e) => alive(e.pid));
  }

  register(entry: RunningEntry): void {
    const list = this.list().filter((x) => x.projectId !== entry.projectId);
    list.push(entry);
    this.write(list);
  }

  unregister(projectId: string): void {
    this.write(this.list().filter((x) => x.projectId !== projectId));
  }

  get(projectId: string): RunningEntry | undefined {
    return this.list().find((x) => x.projectId === projectId);
  }

  freePort(start = 4317): number {
    const used = new Set(this.list().map((x) => x.port));
    let p = start;
    while (used.has(p)) p++;
    return p;
  }
}

export function listAllProjects(): ProjectEntry[] {
  const f = projectsFile();
  if (!existsSync(f)) return [];
  return new ProjectStore(f).list();
}

// Fix 80: Mimar (global) startup'ta projects.json'daki disk'te olmayan
// girisleri ay. talk_to_chief spawn_fail engellenir; resolveProject() stale
// id donmez. Silinen girisler caller'a donulur ki audit log'a yazilsin.
export function pruneStaleProjects(): ProjectEntry[] {
  const f = projectsFile();
  if (!existsSync(f)) return [];
  return new ProjectStore(f).pruneStale();
}

export interface ProjectInfo {
  aciklama?: string;
  mimari?: string;
}

export function readProjectInfo(projectPath: string): ProjectInfo {
  const cfg = join(projectPath, ".team", "config.json");
  if (!existsSync(cfg)) return {};
  try {
    const raw = readFileSync(cfg, "utf8").trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ProjectInfo;
    return { aciklama: parsed.aciklama, mimari: parsed.mimari };
  } catch {
    return {};
  }
}
