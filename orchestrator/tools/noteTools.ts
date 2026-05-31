// orchestrator/tools/noteTools.ts — project + general notes.
// note_add / note_list / note_update / note_delete / note_search.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type ToolContext, type ChiefSelf, ok, fail } from "./types.js";

export function buildNoteTools(ctx: ToolContext, self: ChiefSelf) {
  const { notes, projectId, projectName } = ctx;

  const noteAdd = tool(
    "note_add",
    // Fix 130: shortened — the task-note closing rule is in prompts.ts.
    "Saves a note. The architect saves to general; a project chief to its own project (to general with genel=true).",
    {
      baslik: z.string(),
      icerik: z.string(),
      etiketler: z.array(z.string()).optional(),
      genel: z.boolean().optional(),
    },
    async (args) => {
      const genel = self.isMimar || args.genel === true;
      const n = notes.add({
        baslik: args.baslik,
        icerik: args.icerik,
        kapsam: genel ? "genel" : projectId,
        kapsamAd: genel ? "General" : projectName,
        etiketler: args.etiketler,
      });
      return ok(`Note saved (id ${n.id}).`);
    },
  );

  const noteList = tool(
    "note_list",
    "Lists notes (the architect all; the chief = its own project + general). Resolved notes come with the [RESOLVED] tag.",
    {
      // M4: default cozuldu=false (open notes). With hepsi=true finished notes are also
      // listed.
      hepsi: z.boolean().optional(),
    },
    async (args) => {
      const full = self.isMimar ? notes.list() : notes.forScope(projectId);
      const list = args?.hepsi ? full : full.filter((n) => !n.cozuldu);
      if (!list.length) return ok(args?.hepsi ? "No notes." : "No open (unresolved) notes.");
      return ok(
        list
          .map(
            (n) =>
              `[${n.id}]${n.cozuldu ? " [RESOLVED]" : ""} ${n.sabitli ? "📌 " : ""}${n.baslik} (${n.kapsamAd})` +
              `${n.etiketler.length ? " #" + n.etiketler.join(" #") : ""}\n${n.icerik}`,
          )
          .join("\n\n"),
      );
    },
  );

  const noteUpdate = tool(
    "note_update",
    "Updates a note (baslik/icerik/etiketler/sabitli/cozuldu). If the requested work in a note is finished and verified, mark it with cozuldu=true.",
    {
      id: z.string(),
      baslik: z.string().optional(),
      icerik: z.string().optional(),
      etiketler: z.array(z.string()).optional(),
      sabitli: z.boolean().optional(),
      cozuldu: z.boolean().optional(),
    },
    async (args) => {
      const n = notes.update(args.id, {
        baslik: args.baslik,
        icerik: args.icerik,
        etiketler: args.etiketler,
        sabitli: args.sabitli,
        cozuldu: args.cozuldu,
      });
      return n ? ok(`Note updated: ${args.id}`) : fail(`No note: ${args.id}`);
    },
  );

  const noteDelete = tool(
    "note_delete",
    "Deletes a note.",
    { id: z.string() },
    async (args) => {
      return notes.remove(args.id)
        ? ok(`Note deleted: ${args.id}`)
        : fail(`No note: ${args.id}`);
    },
  );

  const noteSearch = tool(
    "note_search",
    "Searches notes (baslik/icerik/etiket).",
    { sorgu: z.string() },
    async (args) => {
      const res = notes.search(args.sorgu, self.isMimar ? undefined : projectId);
      if (!res.length) return ok("No matching notes.");
      return ok(
        res.map((n) => `[${n.id}] ${n.baslik} (${n.kapsamAd})`).join("\n"),
      );
    },
  );

  return [noteAdd, noteList, noteUpdate, noteDelete, noteSearch];
}
