import { invoke } from "@tauri-apps/api/core";

export interface Note {
  id: string;
  baslik: string;
  icerik: string; // plain text mirror (for search & legacy)
  bodyHtml?: string; // Tiptap HTML output
  images?: string[]; // base64 data URLs for quick-note attachments
  kapsam: string; // "genel" or projeId
  kapsamAd: string; // "Genel" or project name
  etiketler: string[];
  tags?: string[]; // AI generated, separate from manual etiketler (legacy uses etiketler)
  projectId?: string; // explicit project link (mirrors kapsam when not "genel")
  autoTitled?: boolean;
  sabitli: boolean;
  cozuldu?: boolean;
  olusturma: number;
  guncelleme: number;
}

export interface NoteInput {
  baslik: string;
  icerik: string;
  bodyHtml?: string;
  images?: string[];
  kapsam: string;
  kapsamAd: string;
  etiketler: string[];
  projectId?: string;
}

function sirala(list: Note[]): Note[] {
  return [...list].sort((a, b) => {
    // pinned first, resolved last
    if (a.sabitli !== b.sabitli) return a.sabitli ? -1 : 1;
    if (!!a.cozuldu !== !!b.cozuldu) return a.cozuldu ? 1 : -1;
    return b.guncelleme - a.guncelleme;
  });
}

class NotesStore {
  notes = $state<Note[]>([]);
  yukleniyor = $state(false);

  // Each operation reads fresh from disk — orchestrators also write to the same
  // file, so no notes are lost on concurrent writes.
  private async oku(): Promise<Note[]> {
    try {
      const raw = await invoke<string>("read_notes");
      return JSON.parse(raw) as Note[];
    } catch {
      return [];
    }
  }

  private async yaz(list: Note[]): Promise<void> {
    await invoke("write_notes", { json: JSON.stringify(list, null, 2) });
    this.notes = sirala(list);
  }

  async yukle(): Promise<void> {
    this.yukleniyor = true;
    this.notes = sirala(await this.oku());
    this.yukleniyor = false;
  }

  async ekle(input: NoteInput): Promise<string> {
    const cur = await this.oku();
    const now = Date.now();
    const id = crypto.randomUUID();
    cur.push({
      id,
      baslik: input.baslik,
      icerik: input.icerik,
      bodyHtml: input.bodyHtml,
      images: input.images,
      kapsam: input.kapsam,
      kapsamAd: input.kapsamAd,
      etiketler: input.etiketler,
      projectId: input.projectId ?? (input.kapsam !== "genel" ? input.kapsam : undefined),
      autoTitled: false,
      sabitli: false,
      olusturma: now,
      guncelleme: now,
    });
    await this.yaz(cur);
    return id;
  }

  async guncelle(
    id: string,
    patch: Partial<
      Pick<
        Note,
        | "baslik"
        | "icerik"
        | "bodyHtml"
        | "images"
        | "etiketler"
        | "tags"
        | "projectId"
        | "kapsam"
        | "kapsamAd"
        | "autoTitled"
        | "sabitli"
        | "cozuldu"
      >
    >,
  ): Promise<void> {
    const cur = await this.oku();
    const n = cur.find((x) => x.id === id);
    if (!n) return;
    Object.assign(n, patch, { guncelleme: Date.now() });
    await this.yaz(cur);
  }

  async sil(id: string): Promise<void> {
    const cur = await this.oku();
    await this.yaz(cur.filter((n) => n.id !== id));
  }
}

export const notesStore = new NotesStore();

// ---------------------------------------------------------------------------
// myllm helper — OpenAI-compatible chat completions at https://myapi.volpora.com/v1
// No API key wired through Tauri yet; endpoint is currently open (per orchestrator
// prompts.ts). If a key is later required, add `myllmApiKey` to secrets.local.json
// and surface it via a Tauri command, then read it here.
// ---------------------------------------------------------------------------
const MYLLM_ENDPOINT = "https://myapi.volpora.com/v1/chat/completions";
const MYLLM_MODEL = "gpt-4o-mini";

export async function myllmComplete(prompt: string): Promise<string | null> {
  try {
    const res = await fetch(MYLLM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MYLLM_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const txt: string | undefined = data?.choices?.[0]?.message?.content;
    return typeof txt === "string" ? txt.trim() : null;
  } catch {
    return null;
  }
}

export interface AutoTitleResult {
  title: string;
  tags: string[];
}

export async function autoTitleAndTags(plainText: string): Promise<AutoTitleResult | null> {
  const sample = plainText.slice(0, 1000);
  const prompt =
    'Generate a 3-5 word title for this note and 1-3 short tags. Reply ONLY as compact JSON: {"title":"...","tags":["...","..."]}. No prose, no markdown. Note text: ' +
    sample;
  const raw = await myllmComplete(prompt);
  if (!raw) return null;
  // tolerate wrapping code fences
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    const tags = Array.isArray(obj.tags)
      ? obj.tags.filter((t: unknown): t is string => typeof t === "string").map((t: string) => t.trim()).filter(Boolean).slice(0, 3)
      : [];
    if (!title) return null;
    return { title, tags };
  } catch {
    return null;
  }
}
