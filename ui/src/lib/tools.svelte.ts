import { invoke } from "@tauri-apps/api/core";

export interface RepoTool {
  id: string;
  name: string;
  url: string;
  purpose: string;
  category?: string;
  tags: string[];
  addedBy: string;
  source: "manual" | "daily-report" | "chat";
  createdAt: number;
  updatedAt: number;
}

function normalizeUrl(url: string): string {
  return url
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

function sirala(list: RepoTool[]): RepoTool[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

class ToolsStore {
  tools = $state<RepoTool[]>([]);
  yukleniyor = $state(false);

  // Each operation reads fresh from disk — other sources (orchestrator, chat)
  // may also write to the same file, so no data is lost.
  private async oku(): Promise<RepoTool[]> {
    try {
      const raw = await invoke<string>("read_tool_catalog");
      return JSON.parse(raw) as RepoTool[];
    } catch {
      return [];
    }
  }

  private async yaz(list: RepoTool[]): Promise<void> {
    await invoke("write_tool_catalog", { json: JSON.stringify(list, null, 2) });
    this.tools = sirala(list);
  }

  async yukle(): Promise<void> {
    this.yukleniyor = true;
    this.tools = sirala(await this.oku());
    this.yukleniyor = false;
  }

  async ekle(input: {
    url: string;
    name: string;
    purpose: string;
    category?: string;
    tags?: string[];
  }): Promise<void> {
    const cur = await this.oku();
    const normalUrl = normalizeUrl(input.url);
    const normLower = normalUrl.toLowerCase();
    const idx = cur.findIndex(
      (t) => normalizeUrl(t.url).toLowerCase() === normLower,
    );
    if (idx >= 0) {
      // Update if the same URL exists
      Object.assign(cur[idx], {
        name: input.name,
        purpose: input.purpose,
        category: input.category,
        tags: input.tags ?? cur[idx].tags,
        updatedAt: Date.now(),
      });
    } else {
      // New record
      const now = Date.now();
      cur.push({
        id: crypto.randomUUID(),
        name: input.name,
        url: normalUrl,
        purpose: input.purpose,
        category: input.category,
        tags: input.tags ?? [],
        addedBy: "User",
        source: "manual",
        createdAt: now,
        updatedAt: now,
      });
    }
    await this.yaz(cur);
  }

  async guncelle(
    id: string,
    patch: Partial<Omit<RepoTool, "id" | "createdAt">>,
  ): Promise<void> {
    const cur = await this.oku();
    const n = cur.find((t) => t.id === id);
    if (!n) return;
    Object.assign(n, patch, { updatedAt: Date.now() });
    await this.yaz(cur);
  }

  async sil(id: string): Promise<void> {
    const cur = await this.oku();
    await this.yaz(cur.filter((t) => t.id !== id));
  }
}

export const toolsStore = new ToolsStore();
