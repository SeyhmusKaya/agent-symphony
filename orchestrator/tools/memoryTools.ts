// orchestrator/tools/memoryTools.ts — shared + tagged memory tools.
// memory_set / memory_get / memory_remember / memory_search / memory_forget.
// Fix 108: cross-project leak warning (memory_remember).

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type ToolContext, type ChiefSelf, ok, fail } from "./types.js";

export function buildMemoryTools(ctx: ToolContext, self: ChiefSelf) {
  const { memory, tagged, fleet, projectRoot, projectName } = ctx;

  const memorySet = tool(
    "memory_set",
    "Writes a record to the cross-project shared memory.",
    { key: z.string(), value: z.string() },
    async (args) => {
      memory.set(args.key, args.value, projectRoot);
      return ok(`Written to memory: ${args.key}`);
    },
  );

  const memoryGet = tool(
    "memory_get",
    "Reads a record from shared memory. If no key is given, lists ONLY records belonging to this project. The architect sees all records.",
    { key: z.string().optional() },
    async (args) => {
      if (args.key) {
        const entry = memory.get(args.key);
        if (!entry) return fail(`No record: ${args.key}`);
        // Fix 107: cross-project leak — a chief should not reach another project's
        // record by key. Check except for the architect.
        if (!self.isMimar && entry.project && entry.project !== projectRoot) {
          return fail(
            `No record: ${args.key} (for this project). ` +
              `It may belong to another project — do not mix into your own project.`,
          );
        }
        return ok(entry.value);
      }
      // Filter the list too: the architect sees all, the chief only its own project's.
      const list = memory.list();
      const filtered = self.isMimar
        ? list
        : list.filter((e) => !e.project || e.project === projectRoot);
      return ok(JSON.stringify(filtered, null, 2));
    },
  );

  const memoryRemember = tool(
    "memory_remember",
    // Fix 130: shortened — the task/memory_done flow is in prompts.ts.
    "Writes a note to tagged memory (proje:<name> is added automatically). Tags: modul:<name>, tur:profil, tur:karar, tur:gorev.",
    { text: z.string(), tags: z.array(z.string()).optional() },
    async (args) => {
      // Fix 108: chief project-mixing protection. Due to SDK session resume context bias
      // the chief sometimes writes the wrong project name (the Volpora chief wrote memory
      // as "VOLPORA" in the google_yorum project).
      // Protections:
      //   1. Force-overwrite the proje:<name> tag the chief gave to the ACTIVE project.
      //   2. Return the "defined" status of other project names in the text to the chief
      //      as a warning note (we do not delete, so the user notices).
      const incomingTags = args.tags ?? [];
      const sanitized = incomingTags.filter((t) => !t.startsWith("proje:"));
      // For the architect (__global__) the project tag is not forced — global memory.
      const autoProjectTag = self.isMimar ? null : `proje:${projectName}`;
      const finalTags = autoProjectTag ? [autoProjectTag, ...sanitized] : sanitized;
      // Cross-project leak detection: do other project names from the fleet appear as
      // WHOLE WORDs in the text? Return a warning message as an addition.
      const warnings: string[] = [];
      if (!self.isMimar && projectName) {
        try {
          const allProjects = fleet.list();
          for (const p of allProjects) {
            if (p.name === projectName) continue;
            if (p.name.length < 4) continue; // a 1-3 letter name is a false-positive
            const rx = new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i");
            if (rx.test(args.text)) {
              warnings.push(`WARNING: The name of the "${p.name}" project appears in this message. You are the "${projectName}" chief — do not mix into the wrong project name; check the text.`);
            }
          }
        } catch {
          /* skip if the fleet is unreachable */
        }
      }
      const e = await tagged.remember(args.text, finalTags);
      const baseMsg = `Written to memory (id ${e.id}, tags: ${finalTags.join(", ") || "none"}).`;
      if (warnings.length) {
        return ok(`${baseMsg}\n\n${warnings.join("\n")}`);
      }
      return ok(baseMsg);
    },
  );

  const memorySearch = tool(
    "memory_search",
    // Fix 130: shortened — the isolation rule is enforced in code.
    "Semantic+keyword search in memory. The chief sees only its own project; extra filters (tur:karar, modul:*) are AND-ed. The architect searches all projects.",
    {
      sorgu: z.string(),
      filtre: z.array(z.string()).optional(),
      limit: z.number().optional(),
    },
    async (args) => {
      // Fix 116: HARD shutdown of the cross-project leak. The previous Fix 107 only
      // injected the project tag when filtre===undefined; when the agent gave filtre:[]
      // or any tag, isolation was bypassed and other projects' half-done work leaked in
      // (example: the EmlakCopilot chief listed "google yorum" tasks).
      // New rule (user): the chief sees ONLY its own project; ONLY the architect sees all
      // projects. For non-architect:
      //   - the proje:* tags the agent gave are STRIPPED (another project cannot be requested),
      //   - its own project tag is ALWAYS force-added (AND -> only this project),
      //   - other filter tags (tur/modul) are preserved and AND-ed.
      let effectiveFilter: string[];
      if (self.isMimar) {
        effectiveFilter = args.filtre ?? [];
      } else {
        const userTags = (args.filtre ?? []).filter((t) => !t.toLowerCase().startsWith("proje:"));
        effectiveFilter = projectName ? [`proje:${projectName}`, ...userTags] : userTags;
      }
      const res = await tagged.search(args.sorgu, effectiveFilter, args.limit ?? 5);
      if (!res.length) return ok("No matching records.");
      return ok(
        res
          .map((e) => `[${e.id}] (${e.tags.join(", ")})\n${e.text}`)
          .join("\n\n"),
      );
    },
  );

  const memoryForget = tool(
    "memory_forget",
    "PERMANENTLY deletes a record from tagged memory by id. If you completed a task, usually prefer memory_done (history is preserved); use forget for a completely irrelevant/wrong record.",
    { id: z.string() },
    async (args) => {
      return tagged.forget(args.id)
        ? ok(`Deleted: ${args.id}`)
        : fail(`No record: ${args.id}`);
    },
  );

  // Fix 115: close a task when done — the record is not deleted, the durum:bitti tag is
  // added. memory_search excludes these by default → finished work does not reappear in a
  // half-done-work search.
  const memoryDone = tool(
    "memory_done",
    "Marks a task/to-do record as DONE (durum:bitti). The record is not deleted (history preserved) but no longer appears in a half-done-work/memory_search search. When you finish a piece of work, call this with the id of the record that wrote it to memory.",
    { id: z.string() },
    async (args) => {
      return tagged.markDone(args.id)
        ? ok(`Marked as done: ${args.id}`)
        : fail(`No record: ${args.id}`);
    },
  );

  return [memorySet, memoryGet, memoryRemember, memorySearch, memoryForget, memoryDone];
}
