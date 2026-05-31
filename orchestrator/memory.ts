import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { embed, cosine } from "./embed.js";

function safeParseArray<T>(raw: string, label: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (err) {
    console.error(`[memory] ${label} bozuk, gormezden geliniyor: ${String(err)}`);
    return [];
  }
}

export interface MemoryEntry {
  key: string;
  value: string;
  project: string;
  ts: number;
}

export class SharedMemory {
  private filePath: string;
  private entries: MemoryEntry[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8").trim();
      if (raw) this.entries = safeParseArray<MemoryEntry>(raw, "memory.json");
    }
  }

  set(key: string, value: string, project: string): void {
    const existing = this.entries.find((e) => e.key === key);
    if (existing) {
      existing.value = value;
      existing.project = project;
      existing.ts = Date.now();
    } else {
      this.entries.push({ key, value, project, ts: Date.now() });
    }
    this.save();
  }

  get(key: string): MemoryEntry | undefined {
    return this.entries.find((e) => e.key === key);
  }

  list(): MemoryEntry[] {
    return [...this.entries];
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), "utf8");
  }
}

// FAZ B — etiketli, aranabilir hibrit hafiza deposu.
// Etiket ornekleri: "proje:<ad>", "modul:<ad>", "tur:profil|baglanti|karar".
export interface TaggedEntry {
  id: string;
  text: string;
  tags: string[];
  ts: number;
  embedding?: number[];
}

export class TaggedMemory {
  private filePath: string;
  private entries: TaggedEntry[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8").trim();
      if (raw) this.entries = safeParseArray<TaggedEntry>(raw, "tagged-memory.json");
    }
  }

  async remember(text: string, tags: string[]): Promise<TaggedEntry> {
    const emb = await embed(text);
    const entry: TaggedEntry = {
      id: randomUUID().slice(0, 8),
      text,
      tags,
      ts: Date.now(),
      ...(emb ? { embedding: emb } : {}),
    };
    this.entries.push(entry);
    this.save();
    return entry;
  }

  // Keyword (substring) + anlamsal (embedding kosinus) hibrit skor.
  async search(
    queryText: string,
    filterTags: string[] = [],
    limit = 5,
  ): Promise<TaggedEntry[]> {
    let pool = this.entries;
    if (filterTags.length) {
      pool = pool.filter((e) => filterTags.every((t) => e.tags.includes(t)));
    }
    // Fix 115: bitmis gorevler (durum:bitti) varsayilan GIZLI. Yarim-is aramasi
    // tamamlanmis isleri tekrar getirmesin. Acikca durum:bitti filtresi
    // verilirse (gecmis denetimi) gosterilir.
    if (!filterTags.includes("durum:bitti")) {
      pool = pool.filter((e) => !e.tags.includes("durum:bitti"));
    }
    if (!pool.length) return [];
    const qEmb = await embed(queryText);
    const qWords = queryText.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = pool.map((e) => {
      let score = 0;
      const lt = e.text.toLowerCase();
      for (const w of qWords) if (lt.includes(w)) score += 1;
      if (qEmb && e.embedding) score += cosine(qEmb, e.embedding) * 5;
      score += e.ts / 1e15; // cok kucuk recency tiebreak
      return { e, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.e);
  }

  forget(id: string): boolean {
    const n = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length === n) return false;
    this.save();
    return true;
  }

  // Fix 115: bir gorev/yapilacak kaydini "bitti" olarak isaretle. Kaydi SILMEZ
  // (gecmis korunur) — `durum:bitti` tag'i ekler; search varsayilan haric tutar.
  markDone(id: string): boolean {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return false;
    if (!e.tags.includes("durum:bitti")) {
      e.tags.push("durum:bitti");
      this.save();
    }
    return true;
  }

  list(): TaggedEntry[] {
    return [...this.entries];
  }

  // Katman 1 — surekli enjekte edilecek kucuk ozet (~300 token).
  // Kullanici profili + verilen projeye dair son kayitlar.
  summary(projectTag?: string): string {
    const profil = this.entries.filter((e) => e.tags.includes("tur:profil"));
    const proj = projectTag
      ? this.entries.filter((e) => e.tags.includes(projectTag))
      : [];
    const pick = [...profil.slice(-5), ...proj.slice(-5)];
    if (!pick.length) return "";
    let out = pick.map((e) => `- ${e.text}`).join("\n");
    if (out.length > 1200) out = out.slice(0, 1200) + "…";
    return out;
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), "utf8");
  }
}
