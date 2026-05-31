import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface Note {
  id: string;
  baslik: string;
  icerik: string;
  kapsam: string; // "genel" veya projeId
  kapsamAd: string; // "Genel" veya proje adi
  etiketler: string[];
  sabitli: boolean;
  olusturma: number;
  guncelleme: number;
  // M4: ajan notu yapip dogruladiktan sonra true. UI'da cizgi/rozet.
  // Field adi UI ile uyumlu: NotesScreen.svelte cozuldu kullaniyor.
  cozuldu?: boolean;
  cozulduTs?: number; // ne zaman tamamlandi
}

export interface NoteInput {
  baslik: string;
  icerik: string;
  kapsam: string;
  kapsamAd: string;
  etiketler?: string[];
}

export class NoteStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  // Her islemde diskten taze okur — UI ve orkestrator ayni dosyaya yazar.
  private read(): Note[] {
    if (!existsSync(this.filePath)) return [];
    const raw = readFileSync(this.filePath, "utf8").trim();
    if (!raw) return [];
    try {
      return JSON.parse(raw) as Note[];
    } catch {
      return [];
    }
  }

  // Atomik yazim — temp dosya + rename, kismi yazimi onler.
  private write(notes: Note[]): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(notes, null, 2), "utf8");
    renameSync(tmp, this.filePath);
  }

  add(input: NoteInput): Note {
    const now = Date.now();
    const note: Note = {
      id: randomUUID(),
      baslik: input.baslik,
      icerik: input.icerik,
      kapsam: input.kapsam,
      kapsamAd: input.kapsamAd,
      etiketler: input.etiketler ?? [],
      sabitli: false,
      olusturma: now,
      guncelleme: now,
    };
    const notes = this.read();
    notes.push(note);
    this.write(notes);
    return note;
  }

  list(): Note[] {
    return this.read().sort((a, b) => {
      if (a.sabitli !== b.sabitli) return a.sabitli ? -1 : 1;
      return b.guncelleme - a.guncelleme;
    });
  }

  // Bir sefin gorebilecekleri: kendi projesi + genel notlar.
  forScope(projeId: string): Note[] {
    return this.list().filter((n) => n.kapsam === projeId || n.kapsam === "genel");
  }

  update(
    id: string,
    patch: Partial<Pick<Note, "baslik" | "icerik" | "etiketler" | "sabitli" | "cozuldu">>,
  ): Note | null {
    const notes = this.read();
    const n = notes.find((x) => x.id === id);
    if (!n) return null;
    if (patch.baslik !== undefined) n.baslik = patch.baslik;
    if (patch.icerik !== undefined) n.icerik = patch.icerik;
    if (patch.etiketler !== undefined) n.etiketler = patch.etiketler;
    if (patch.sabitli !== undefined) n.sabitli = patch.sabitli;
    if (patch.cozuldu !== undefined) {
      n.cozuldu = patch.cozuldu;
      n.cozulduTs = patch.cozuldu ? Date.now() : undefined;
    }
    n.guncelleme = Date.now();
    this.write(notes);
    return n;
  }

  remove(id: string): boolean {
    const notes = this.read();
    const kept = notes.filter((n) => n.id !== id);
    if (kept.length === notes.length) return false;
    this.write(kept);
    return true;
  }

  search(sorgu: string, scope?: string): Note[] {
    const q = sorgu.toLowerCase();
    let pool = this.list();
    if (scope) pool = pool.filter((n) => n.kapsam === scope || n.kapsam === "genel");
    return pool.filter(
      (n) =>
        n.baslik.toLowerCase().includes(q) ||
        n.icerik.toLowerCase().includes(q) ||
        n.etiketler.some((e) => e.toLowerCase().includes(q)),
    );
  }
}
