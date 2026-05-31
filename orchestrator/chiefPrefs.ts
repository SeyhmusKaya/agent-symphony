// chief-model.json kayit/okuma. Per-project sef model + effort tercihi
// persist edilir; restart sonrasi UI default'u korunur. F9 ek parcalama.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appDataDir } from "./fleet.js";
import type { Effort } from "./effort.js";

export interface ChiefPrefs {
  model: string;
  effort: Effort;
  // Fast mode (priority service tier). undefined = eski dosya → false.
  fast?: boolean;
}

export function chiefPrefsFilePath(): string {
  return join(appDataDir(), "chief-model.json");
}

export function loadChiefPrefs(projectId: string): ChiefPrefs {
  // Varsayilan: Opus 4.8 (1m) high — regular tier ($15/$75), kalite kritik.
  // Mimar/Sef/Advisor hepsi ayni default. Uzmanlar kendi specialist tarafindan
  // claude-opus-4-8-fast[1m] + medium ile spawn edilir (3x ucuz + 2.5x hizli).
  // Kullanici UI'dan setChiefModel ile her zaman degistirebilir.
  const def: ChiefPrefs = { model: "claude-opus-4-8", effort: "high", fast: false };
  const file = chiefPrefsFilePath();
  if (!existsSync(file)) return def;
  try {
    const raw = readFileSync(file, "utf8").trim();
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Record<string, { model?: string; effort?: Effort; fast?: boolean }>;
    const entry = parsed[projectId];
    if (entry?.model) {
      return { model: entry.model, effort: entry.effort ?? def.effort, fast: entry.fast ?? false };
    }
  } catch {
    /* corrupt — default'a don */
  }
  return def;
}

export function saveChiefPrefs(projectId: string, prefs: ChiefPrefs): void {
  try {
    const file = chiefPrefsFilePath();
    const existing: Record<string, ChiefPrefs> = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, ChiefPrefs>)
      : {};
    existing[projectId] = prefs;
    writeFileSync(file, JSON.stringify(existing, null, 2), "utf8");
  } catch {
    /* yoksay */
  }
}
