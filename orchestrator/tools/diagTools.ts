// orchestrator/tools/diagTools.ts — system diagnostic tools.
// read_logs / log_search / audit_search / daily_report / tool_usage_report.
// The architect + chief monitor system behavior — response latency, errors, token flow.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { join } from "node:path";
import { appDataDir } from "../fleet.js";
import { listLogs, readLog, searchLogs } from "../logger.js";
import { dailyReport } from "../report.js";
import {
  type ToolContext,
  ok,
  fail,
  capLarge,
  LOG_RESULT_CAP,
} from "./types.js";

export function buildDiagTools(ctx: ToolContext) {
  const { audit, usage, toolUsage } = ctx;
  const logDir = join(appDataDir(), "logs");

  const readLogs = tool(
    "read_logs",
    "Reads system logs. If kaynak is absent, the file list; if present, the last lines.",
    { kaynak: z.string().optional(), satir: z.number().optional() },
    async (args) => {
      if (!args.kaynak) {
        const files = listLogs(logDir);
        return ok(files.length ? `Log files:\n${files.join("\n")}` : "No logs.");
      }
      const c = readLog(logDir, args.kaynak, args.satir ?? 200);
      return c ? ok(capLarge(c, LOG_RESULT_CAP)) : fail(`Log not found: ${args.kaynak}`);
    },
  );

  const logSearch = tool(
    "log_search",
    "Search logs (text/level). level='error' returns all errors.",
    {
      metin: z.string().optional(),
      level: z.enum(["debug", "info", "warn", "error"]).optional(),
      limit: z.number().optional(),
    },
    async (args) => {
      const res = searchLogs(logDir, {
        metin: args.metin,
        level: args.level,
        limit: args.limit ?? 100,
      });
      return ok(capLarge(res || "No matching logs.", LOG_RESULT_CAP));
    },
  );

  const auditSearch = tool(
    "audit_search",
    "Searches the event archive (type and/or text).",
    { type: z.string().optional(), text: z.string().optional(), limit: z.number().optional() },
    async (args) => {
      const rows = audit.search({ type: args.type, text: args.text, limit: args.limit });
      return ok(capLarge(JSON.stringify(rows, null, 2), LOG_RESULT_CAP));
    },
  );

  const dailyReportTool = tool(
    "daily_report",
    "Returns today's token usage and event summary.",
    {},
    async () => ok(capLarge(dailyReport(usage, audit), LOG_RESULT_CAP)),
  );

  // Tool usage report — returns a summary of tool calls over the last N days. The
  // architect can revise its own tools (move rarely-used core tools into a group, delete
  // an unused group).
  const toolKullanimRaporu = tool(
    "tool_usage_report",
    "Returns tool usage statistics: most/least used, error rate, last used. detay=true for all tools (default summary).",
    {
      detay: z.boolean().optional().describe("if true list all tools, if false a summary"),
    },
    async (args) => {
      if (!toolUsage) return fail("Tool usage telemetry is not configured.");
      if (args.detay) {
        const all = toolUsage.all();
        if (!all.length) return ok("(no tool usage data yet)");
        const lines = ["All tool usage data (by descending count):"];
        for (const r of all) {
          const errPct = r.count ? `${((r.errors / r.count) * 100).toFixed(0)}%` : "0%";
          const sonKullanim = r.lastUsed ? new Date(r.lastUsed).toISOString().slice(0, 16).replace("T", " ") : "-";
          lines.push(`  ${r.ad.padEnd(28)} ${String(r.count).padStart(5)} calls | error ${errPct} | last: ${sonKullanim}`);
        }
        return ok(lines.join("\n"));
      }
      return ok(toolUsage.summary());
    },
  );

  return [readLogs, logSearch, auditSearch, dailyReportTool, toolKullanimRaporu];
}
