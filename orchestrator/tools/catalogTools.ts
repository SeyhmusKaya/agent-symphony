// orchestrator/tools/catalogTools.ts — ecosystem GitHub tool catalog tools.
// tool_catalog_add / tool_catalog_list / tool_catalog_search / tool_catalog_remove.
// Global store (appDataDir/tool-catalog.json) — all agents (architect+chief+advisor) see
// the same catalog. Token-cheap: the catalog is not pre-loaded, called on demand.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type ToolContext, ok, fail } from "./types.js";

// Single-line summary — so list/search output is token-cheap.
function fmtLine(r: {
  id: string;
  name: string;
  url: string;
  purpose: string;
  category?: string;
  tags: string[];
}): string {
  const cat = r.category ? ` [${r.category}]` : "";
  const tg = r.tags.length ? ` #${r.tags.join(" #")}` : "";
  return `[${r.id}] ${r.name}${cat} — ${r.url}\n   ${r.purpose}${tg}`;
}

export function buildCatalogTools(ctx: ToolContext) {
  const { catalog, projectName } = ctx;

  const catalogAdd = tool(
    "tool_catalog_add",
    "Adds a repo to the ecosystem GitHub tool catalog (all agents see it). Use it when the user drops a repo and says 'save', or when an important repo is found in the night scan. purpose = what it is for (1-3 sentences, CLEAR). If the same URL exists it updates (no duplicates).",
    {
      url: z.string().describe("GitHub repo URL"),
      name: z.string().describe("Repo name, e.g. Skyvern"),
      purpose: z.string().describe("What it is for — a 1-3 sentence description"),
      category: z.string().optional().describe("e.g. browser-automation, scraping, agent-framework"),
      tags: z.array(z.string()).optional(),
      source: z.enum(["manual", "daily-report", "chat"]).optional(),
    },
    async (args) => {
      const r = catalog.add({
        url: args.url,
        name: args.name,
        purpose: args.purpose,
        category: args.category,
        tags: args.tags,
        addedBy: projectName || "Mimar",
        source: args.source ?? "chat",
      });
      return ok(`Catalog saved (id ${r.id}): ${r.name} — ${r.url}`);
    },
  );

  const catalogList = tool(
    "tool_catalog_list",
    "Lists all GitHub repos in the tool catalog (name + link + what it is for). Before writing code/picking a tool, check whether a ready solution exists.",
    {},
    async () => {
      const items = catalog.list();
      if (!items.length) return ok("Catalog is empty. You can add a repo with tool_catalog_add.");
      return ok(`${items.length} tools:\n\n${items.map(fmtLine).join("\n\n")}`);
    },
  );

  const catalogSearch = tool(
    "tool_catalog_search",
    "Searches the tool catalog by keyword (name/description/category/tag/url). When you are about to look for a ready tool for a job, call this first.",
    { query: z.string() },
    async (args) => {
      const res = catalog.search(args.query);
      if (!res.length) return ok(`No matching tool for "${args.query}".`);
      return ok(`${res.length} matches:\n\n${res.map(fmtLine).join("\n\n")}`);
    },
  );

  const catalogRemove = tool(
    "tool_catalog_remove",
    "Removes a repo from the tool catalog by id.",
    { id: z.string() },
    async (args) => {
      return catalog.remove(args.id)
        ? ok(`Removed from catalog: ${args.id}`)
        : fail(`Not in catalog: ${args.id}`);
    },
  );

  return [catalogAdd, catalogList, catalogSearch, catalogRemove];
}
