// Runtime error fingerprint tracking + auto-rollback trigger.
//
// Purpose: if the same error happens repeatedly in a short time (loop) or a
// pattern in a critical category (400 cache_control, module not found, etc.)
// is detected, automatically roll back to the last healthy commit. This way
// the system recovers itself before the user sees 10+ consecutive "400 errors".
//
// Flow:
//   In addition to logger.error(), errorTracker.report(mesaj) is called.
//   The tracker computes a fingerprint, assigns a category, increments the counter.
//   - Critical category (immediate): rollback is triggered in a single occurrence.
//   - Loop category: >=3 identical fingerprints within 5 min -> rollback.
//   Wire up the rollback callback in main.ts (autoRollback.ts).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export type ErrorCategory =
  | "cache_control" // HTTP 400 "maximum cache_control"
  | "auth" // HTTP 401 sustained
  | "upstream_5xx" // HTTP 500/502/503 sustained
  | "module_not_found" // Cannot find module / require failed
  | "type_error" // TypeError ... is not a function
  | "tool_exception" // same tool callback throws repeatedly
  | "idle_timeout" // chief produced no activity for 5 min (repeated)
  | "other";

export interface ErrorRecord {
  fingerprint: string;
  category: ErrorCategory;
  firstSeen: number;
  lastSeen: number;
  count: number;
}

export interface RollbackTrigger {
  reason: string;
  category: ErrorCategory;
  fingerprint: string;
  count: number;
  immediate: boolean;
}

// Category decision — return the most specific pattern based on message content.
export function categorize(mesaj: string): ErrorCategory {
  const m = mesaj.toLowerCase();
  if (m.includes("cache_control") && m.includes("400")) return "cache_control";
  if (m.includes("cache_control") && m.includes("maximum")) return "cache_control";
  if (m.includes("401") && (m.includes("unauthorized") || m.includes("auth"))) return "auth";
  if (
    (m.includes("500") || m.includes("502") || m.includes("503") || m.includes("upstream")) &&
    !m.includes("400")
  )
    return "upstream_5xx";
  if (m.includes("cannot find module") || m.includes("module not found")) return "module_not_found";
  if (m.includes("typeerror") && m.includes("is not a function")) return "type_error";
  if (m.includes("idle timeout")) return "idle_timeout";
  return "other";
}

// Fingerprint: category + the "stable" part of the message (drop variable
// parts like length/timestamp/port). Simple approach: first 120 chars +
// category, numbers normalized.
export function fingerprint(mesaj: string, category: ErrorCategory): string {
  const stripped = mesaj
    .replace(/\d+/g, "N") // all numbers N
    .replace(/[a-f0-9]{8,}/g, "HEX") // hash-like long hex
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${category}::${stripped}`;
}

// Critical category — rollback is triggered on first sight (no loop wait).
// These categories are the DIRECT result of a code change (proxy, missing dep) —
// retry does not fix them, only the old version does.
const IMMEDIATE_CATEGORIES = new Set<ErrorCategory>([
  "cache_control",
  "module_not_found",
  "type_error",
]);

// Loop threshold: same fingerprint N times within 5 minutes -> trigger.
// P1.27: 3 -> 8 (reduce red banner spam in the UI; during tests, rollback is
// tried after 8 identical errors rather than 3).
const LOOP_WINDOW_MS = 5 * 60_000;
const LOOP_THRESHOLD = 8;

// Tool callback exception: N consecutive errors for the same tool = trigger.
// P1.27: 5 -> 10 (reduce false positives).
const TOOL_EXCEPTION_THRESHOLD = 10;

export interface ErrorTrackerOpts {
  persistPath: string; // appDataDir()/error-fingerprints.json
  onRollback: (trigger: RollbackTrigger) => void; // anti-rollback handler
  cooldownMs?: number; // skip triggers for N ms after a rollback (default 2 min)
}

export class ErrorTracker {
  private records = new Map<string, ErrorRecord>();
  private toolErrors = new Map<string, number>(); // tool name -> consecutive errors
  private lastRollbackAt = 0;
  private readonly persistPath: string;
  private readonly onRollback: (t: RollbackTrigger) => void;
  private readonly cooldownMs: number;

  constructor(opts: ErrorTrackerOpts) {
    this.persistPath = opts.persistPath;
    this.onRollback = opts.onRollback;
    this.cooldownMs = opts.cooldownMs ?? 120_000;
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.persistPath)) return;
      const raw = readFileSync(this.persistPath, "utf8");
      const arr = JSON.parse(raw) as ErrorRecord[];
      const cutoff = Date.now() - LOOP_WINDOW_MS;
      for (const r of arr) {
        if (r.lastSeen >= cutoff) this.records.set(r.fingerprint, r);
      }
    } catch {
      /* ignore */
    }
  }

  private persist(): void {
    try {
      const dir = dirname(this.persistPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(
        this.persistPath,
        JSON.stringify([...this.records.values()], null, 2),
        "utf8",
      );
    } catch {
      /* ignore */
    }
  }

  // General error report — pass alongside main.ts's logger.error calls.
  report(mesaj: string, opts?: { toolName?: string }): void {
    const category = categorize(mesaj);
    const fp = fingerprint(mesaj, category);
    const now = Date.now();
    const rec = this.records.get(fp);
    if (rec) {
      rec.count++;
      rec.lastSeen = now;
    } else {
      this.records.set(fp, {
        fingerprint: fp,
        category,
        firstSeen: now,
        lastSeen: now,
        count: 1,
      });
    }

    // Tool-specific consecutive error counter.
    if (opts?.toolName) {
      const n = (this.toolErrors.get(opts.toolName) ?? 0) + 1;
      this.toolErrors.set(opts.toolName, n);
      if (n >= TOOL_EXCEPTION_THRESHOLD) {
        this.maybeRollback({
          reason: `Tool "${opts.toolName}" threw an error ${n} consecutive times.`,
          category: "tool_exception",
          fingerprint: `tool::${opts.toolName}`,
          count: n,
          immediate: true,
        });
      }
    }

    this.persist();

    // Critical category — trigger on first occurrence.
    if (IMMEDIATE_CATEGORIES.has(category)) {
      this.maybeRollback({
        reason: `Critical error category: ${category}. Message: ${mesaj.slice(0, 200)}`,
        category,
        fingerprint: fp,
        count: this.records.get(fp)!.count,
        immediate: true,
      });
      return;
    }

    // Loop — did it reach the threshold within the 5 min window?
    const r = this.records.get(fp)!;
    if (r.lastSeen - r.firstSeen <= LOOP_WINDOW_MS && r.count >= LOOP_THRESHOLD) {
      this.maybeRollback({
        reason: `The same error recurred ${r.count} times within ${Math.round((r.lastSeen - r.firstSeen) / 1000)}s.`,
        category,
        fingerprint: fp,
        count: r.count,
        immediate: false,
      });
    }
  }

  // Tool success notice — reset the consecutive error counter.
  reportToolOk(toolName: string): void {
    if (this.toolErrors.has(toolName)) this.toolErrors.delete(toolName);
  }

  private maybeRollback(trigger: RollbackTrigger): void {
    const now = Date.now();
    if (now - this.lastRollbackAt < this.cooldownMs) return; // cooldown
    this.lastRollbackAt = now;
    // Reset counters — if the same error recurs in the new version, a second
    // rollback (autoRollback.ts does an extra check to prevent infinite loops).
    this.records.clear();
    this.toolErrors.clear();
    this.persist();
    this.onRollback(trigger);
  }

  // Summary for the status payload.
  summary(): { fingerprints: ErrorRecord[]; toolErrors: Record<string, number> } {
    return {
      fingerprints: [...this.records.values()].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 20),
      toolErrors: Object.fromEntries(this.toolErrors),
    };
  }
}

// Helper: build the file path.
export function defaultPersistPath(appDataDir: string): string {
  return join(appDataDir, "error-fingerprints.json");
}
