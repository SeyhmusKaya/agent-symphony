import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Task #98/99: xhigh + max effort levels with Opus 4.8 (ultracode dynamic
// workflow trigger). The SDK AgentDefinition.effort has the same 5 values.
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Task #99 + Fix 104: Specialists default to Opus 4.8 + medium effort.
// Opus is always 1m context (the [1m] alias is added during the backend SDK call).
// Sonnet/Haiku are always 200k. The fast tier comes later via service_tier.
export const DEFAULT_MODEL = "claude-opus-4-8";
// User request: the specialist default effort is high (not medium).
export const DEFAULT_EFFORT: Effort = "high";
// Deprecated model slug -> current. sonnet-4-5 is no longer used; on load
// persisted specialist definitions are auto-migrated to sonnet-4-6.
const DEPRECATED_MODEL_MAP: Record<string, string> = {
  "claude-sonnet-4-5": "claude-sonnet-4-6",
  // Fix 118: bare alias -> tam slug. Eski uzmanlar (orn. google yorum) model'i
  // kisa "sonnet"/"opus" alias'iyla kaydetmis; UI ham degeri gosterince
  // projeler arasi tutarsiz rozet ("sonnet" vs "claude-sonnet-4-6") cikiyordu.
  // load() bunlari tam slug'a migrate edip diske yazar -> tutarli gosterim.
  "sonnet": "claude-sonnet-4-6",
  "opus": "claude-opus-4-8",
  "haiku": "claude-haiku-4-5",
};

// Fix 99: specialist chat persistence. The UI agentChat was $derived from the
// feed; on window close → feed=[] → the chat emptied. This record persists on disk.
export interface SpecialistChatEntry {
  // "uzman" = the specialist's own reply (native Agent tool result). Other roles
  // are a message RECEIVED by the specialist (chief task / user / agent command).
  role: "kullanici" | "sef" | "ajan_komut" | "uzman";
  text: string;
  ts: number;
  // Tool aktivitesi varsa eklenir.
  transcript?: string;
  // Cost gostergesi.
  usage?: { input: number; output: number; usd?: number };
  // Hata varsa kirmizi rozet.
  hata?: boolean;
  fromAgent?: string;
}

export interface SpecialistDef {
  name: string;
  role: string;
  systemPrompt: string;
  allowedTools: string[];
  model: string;
  effort: Effort;
  skills: string[];
  sessionId: string | null;
  // Fix 99: new field — the chat ARRAY is backed up persistently.
  chat?: SpecialistChatEntry[];
}

export interface CreateSpecialistInput {
  name: string;
  role: string;
  systemPrompt: string;
  allowedTools?: string[];
  model?: string;
  effort?: Effort;
  skills?: string[];
}

export class AgentRegistry {
  private filePath: string;
  private agents = new Map<string, SpecialistDef>();
  // Fix 144: cross-process clobber protection. While this chief is running,
  // ANOTHER process (e.g. the Architect via Bash) can add a NEW specialist to
  // the same agents.json. save() used to write only in-memory -> externally
  // added specialists on disk were OVERWRITTEN (autoexpertise 3->1, MyLLM 3->0).
  // Solution: save() merges from disk before writing; it does not include the
  // ones we EXPLICITLY deleted (removedNames) in the merge.
  private removedNames = new Set<string>();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    const raw = readFileSync(this.filePath, "utf8").trim();
    if (!raw) return;
    let parsed: SpecialistDef[];
    try {
      parsed = JSON.parse(raw) as SpecialistDef[];
    } catch (err) {
      console.error(`[registry] agents.json bozuk, gormezden geliniyor: ${String(err)}`);
      return;
    }
    if (!Array.isArray(parsed)) return;
    this.agents.clear();
    let migrated = false;
    for (const def of parsed) {
      // Deprecated model slug migration (orn. sonnet-4-5 -> sonnet-4-6).
      const mapped = def.model ? DEPRECATED_MODEL_MAP[def.model] : undefined;
      if (mapped) {
        def.model = mapped;
        migrated = true;
      }
      this.agents.set(def.name, def);
    }
    // If a migration happened, write to disk once — make it persistent.
    if (migrated) this.save();
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Fix 144: merge from disk before writing — do not overwrite specialists
    // added by another process (the Architect). Take disk specialists we do NOT
    // have + that we did not delete.
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf8").trim();
        if (raw) {
          const disk = JSON.parse(raw) as SpecialistDef[];
          if (Array.isArray(disk)) {
            for (const d of disk) {
              if (
                d &&
                typeof d.name === "string" &&
                !this.agents.has(d.name) &&
                !this.removedNames.has(d.name)
              ) {
                this.agents.set(d.name, d);
              }
            }
          }
        }
      }
    } catch {
      /* disk okunamadi/bozuk — merge atla, normal yaz */
    }
    writeFileSync(this.filePath, JSON.stringify([...this.agents.values()], null, 2), "utf8");
  }

  create(input: CreateSpecialistInput): SpecialistDef {
    if (this.agents.has(input.name)) {
      throw new Error(`Uzman zaten var: ${input.name}`);
    }
    const def: SpecialistDef = {
      name: input.name,
      role: input.role,
      systemPrompt: input.systemPrompt,
      allowedTools: input.allowedTools ?? [],
      model: input.model ?? DEFAULT_MODEL,
      effort: input.effort ?? DEFAULT_EFFORT,
      skills: input.skills ?? [],
      sessionId: null,
    };
    this.agents.set(def.name, def);
    this.save();
    return def;
  }

  get(name: string): SpecialistDef | undefined {
    return this.agents.get(name);
  }

  list(): SpecialistDef[] {
    return [...this.agents.values()];
  }

  updateSession(name: string, sessionId: string): void {
    const def = this.require(name);
    def.sessionId = sessionId;
    this.save();
  }

  clearSession(name: string): void {
    const def = this.require(name);
    def.sessionId = null;
    this.save();
  }

  updateModel(name: string, model?: string, effort?: Effort): void {
    const def = this.require(name);
    if (model !== undefined) def.model = model;
    if (effort !== undefined) def.effort = effort;
    this.save();
  }

  updateSkills(name: string, skills: string[]): void {
    const def = this.require(name);
    def.skills = skills;
    this.save();
  }

  remove(name: string): void {
    if (!this.agents.delete(name)) {
      throw new Error(`Uzman bulunamadi: ${name}`);
    }
    // Fix 144: silineni tombstone'a ekle — merge-on-save diskten geri ALMASIN.
    this.removedNames.add(name);
    this.save();
  }

  // Fix 99: chat append. Disk persist. Max 100 entry tutar (eskilerini atar).
  appendChat(name: string, entry: SpecialistChatEntry): void {
    const def = this.agents.get(name);
    if (!def) return;
    if (!def.chat) def.chat = [];
    def.chat.push(entry);
    // Cap: son 100 entry tut. Eski mesajlar disk'i sismesin.
    if (def.chat.length > 100) {
      def.chat = def.chat.slice(-100);
    }
    this.save();
  }

  getChat(name: string): SpecialistChatEntry[] {
    const def = this.agents.get(name);
    return def?.chat ?? [];
  }

  clearChat(name: string): void {
    const def = this.agents.get(name);
    if (!def) return;
    def.chat = [];
    this.save();
  }

  // Chat snapshot for all specialists — the status goes to the UI inside pushStatus.
  allChats(): Record<string, SpecialistChatEntry[]> {
    const out: Record<string, SpecialistChatEntry[]> = {};
    for (const def of this.agents.values()) {
      if (def.chat && def.chat.length > 0) out[def.name] = def.chat;
    }
    return out;
  }

  private require(name: string): SpecialistDef {
    const def = this.agents.get(name);
    if (!def) throw new Error(`Uzman bulunamadi: ${name}`);
    return def;
  }
}
