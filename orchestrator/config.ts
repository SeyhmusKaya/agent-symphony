import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type SkillScope = "genel" | "proje" | "uzman";

export interface McpEntry {
  name: string;
  config: unknown;
}

export interface ProjectConfig {
  mcpServers: McpEntry[];
  skills: {
    genel: string[];
    proje: string[];
    uzman: Record<string, string[]>;
  };
  tokenGunlukLimit: number;
  planModu: boolean;
  disariAc: { aktif: boolean; port: number; token: string };
  plugins: string[];
  aciklama: string;
  mimari: string;
}

function emptyConfig(): ProjectConfig {
  return {
    mcpServers: [],
    skills: { genel: [], proje: [], uzman: {} },
    tokenGunlukLimit: 0,
    planModu: false,
    disariAc: { aktif: false, port: 4600, token: "" },
    plugins: [],
    aciklama: "",
    mimari: "",
  };
}

export class ProjectConfigStore {
  private filePath: string;
  private config: ProjectConfig = emptyConfig();

  constructor(filePath: string) {
    this.filePath = filePath;
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8").trim();
      if (raw) this.config = { ...emptyConfig(), ...(JSON.parse(raw) as ProjectConfig) };
    }
  }

  get(): ProjectConfig {
    return this.config;
  }

  addMcp(entry: McpEntry): void {
    if (this.config.mcpServers.some((m) => m.name === entry.name)) return;
    this.config.mcpServers.push(entry);
    this.save();
  }

  removeMcp(name: string): void {
    this.config.mcpServers = this.config.mcpServers.filter((m) => m.name !== name);
    this.save();
  }

  setInfo(aciklama: string | undefined, mimari: string | undefined): void {
    if (aciklama !== undefined) this.config.aciklama = aciklama;
    if (mimari !== undefined) this.config.mimari = mimari;
    this.save();
  }

  addPlugin(path: string): void {
    if (!this.config.plugins.includes(path)) {
      this.config.plugins.push(path);
      this.save();
    }
  }

  removePlugin(path: string): void {
    this.config.plugins = this.config.plugins.filter((p) => p !== path);
    this.save();
  }

  addSkill(skill: string, scope: SkillScope, agent?: string): void {
    if (scope === "uzman") {
      if (!agent) throw new Error("Uzman kapsamli skill icin ajan adi gerekli.");
      const list = this.config.skills.uzman[agent] ?? [];
      if (!list.includes(skill)) {
        this.config.skills.uzman[agent] = [...list, skill];
      }
    } else {
      const list = this.config.skills[scope];
      if (!list.includes(skill)) list.push(skill);
    }
    this.save();
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.config, null, 2), "utf8");
  }
}
