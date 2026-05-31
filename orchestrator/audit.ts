import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ArchitectEvent } from "./events.js";

export interface AuditQuery {
  type?: string;
  text?: string;
  limit?: number;
}

export class AuditLog {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  append(event: ArchitectEvent): void {
    appendFileSync(this.filePath, JSON.stringify(event) + "\n", "utf8");
  }

  all(): ArchitectEvent[] {
    if (!existsSync(this.filePath)) return [];
    return readFileSync(this.filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ArchitectEvent);
  }

  search(query: AuditQuery): ArchitectEvent[] {
    let rows = this.all();
    if (query.type) rows = rows.filter((e) => e.type === query.type);
    if (query.text) {
      const t = query.text.toLowerCase();
      rows = rows.filter((e) => JSON.stringify(e.payload).toLowerCase().includes(t));
    }
    const limit = query.limit ?? 100;
    return rows.slice(-limit);
  }
}
