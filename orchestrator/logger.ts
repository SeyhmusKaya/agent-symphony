import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: number;
  level: LogLevel;
  kaynak: string; // orchestrator name/id
  olay: string;
  detay?: unknown;
}

const MAX_BYTES = 3_000_000;
const KEEP_LINES = 3000;

export class Logger {
  private filePath: string;
  private kaynak: string;

  constructor(logDir: string, kaynak: string) {
    this.kaynak = kaynak;
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const safe = kaynak.replace(/[^a-zA-Z0-9_.-]/g, "_");
    this.filePath = join(logDir, `${safe}.log`);
    this.trimIfBig();
  }

  private trimIfBig(): void {
    try {
      if (existsSync(this.filePath) && statSync(this.filePath).size > MAX_BYTES) {
        const lines = readFileSync(this.filePath, "utf8").split("\n");
        writeFileSync(this.filePath, lines.slice(-KEEP_LINES).join("\n"), "utf8");
      }
    } catch {
      /* ignore */
    }
  }

  log(level: LogLevel, olay: string, detay?: unknown): void {
    const entry: LogEntry = { ts: Date.now(), level, kaynak: this.kaynak, olay, detay };
    try {
      appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf8");
    } catch {
      /* ignore */
    }
  }

  debug(olay: string, detay?: unknown): void {
    this.log("debug", olay, detay);
  }
  info(olay: string, detay?: unknown): void {
    this.log("info", olay, detay);
  }
  warn(olay: string, detay?: unknown): void {
    this.log("warn", olay, detay);
  }
  error(olay: string, detay?: unknown): void {
    this.log("error", olay, detay);
  }
}

// The Architect sees all log files.
export function listLogs(logDir: string): string[] {
  if (!existsSync(logDir)) return [];
  return readdirSync(logDir).filter((f) => f.endsWith(".log"));
}

export function readLog(logDir: string, file: string, lines = 200): string {
  const safe = file.endsWith(".log") ? file : `${file}.log`;
  const p = join(logDir, safe);
  if (!existsSync(p)) return "";
  const all = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  return all.slice(-lines).join("\n");
}

// Text/level search across all logs (for Architect diagnostics).
export function searchLogs(
  logDir: string,
  opts: { metin?: string; level?: LogLevel; limit?: number },
): string {
  if (!existsSync(logDir)) return "";
  const limit = opts.limit ?? 100;
  const hits: LogEntry[] = [];
  for (const f of listLogs(logDir)) {
    const raw = readFileSync(join(logDir, f), "utf8").trim().split("\n").filter(Boolean);
    for (const line of raw) {
      let e: LogEntry;
      try {
        e = JSON.parse(line) as LogEntry;
      } catch {
        continue;
      }
      if (opts.level && e.level !== opts.level) continue;
      if (opts.metin && !JSON.stringify(e).toLowerCase().includes(opts.metin.toLowerCase()))
        continue;
      hits.push(e);
    }
  }
  hits.sort((a, b) => b.ts - a.ts);
  return hits.slice(0, limit).map((e) => JSON.stringify(e)).join("\n");
}
