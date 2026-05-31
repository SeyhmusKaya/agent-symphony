// orchestrator/tools/securityTools.ts — URL security audit.
// security_scan: header (CSP/HSTS/X-Frame), cookie flag, CORS, fingerprint,
// standard path scan. Use only on domains you own.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { scanUrl, scanExtras } from "../securityScan.js";
import { type ToolContext, ok, fail } from "./types.js";

export function buildSecurityTools(_ctx: ToolContext) {
  const guvenlikTaramasi = tool(
    "security_scan",
    "URL security audit: header (CSP/HSTS/X-Frame), cookie flag, CORS, fingerprint, standard paths. Severity-grouped findings. Only on domains you own.",
    { url: z.string(), extras: z.boolean().optional() },
    async (args) => {
      try {
        const main = await scanUrl(args.url);
        let extrasOut: Record<string, { exists: boolean; status?: number }> | undefined;
        if (args.extras) extrasOut = await scanExtras(args.url);
        // Summary — for the architect/chief to read quickly.
        const high = main.findings.filter((f) => f.severity === "high").length;
        const med = main.findings.filter((f) => f.severity === "medium").length;
        const summary =
          `Scan complete: ${main.finalUrl} → ${main.statusCode} ` +
          `(${main.responseTimeMs}ms). Missing headers: ${main.missingSecurityHeaders.length}, ` +
          `Cookie: ${main.cookies.length}, Findings: ${high} high / ${med} medium.\n\n`;
        return ok(summary + JSON.stringify({ main, extras: extrasOut }, null, 2));
      } catch (e) {
        return fail(`Scan error: ${(e as Error).message}`);
      }
    },
  );

  return [guvenlikTaramasi];
}
