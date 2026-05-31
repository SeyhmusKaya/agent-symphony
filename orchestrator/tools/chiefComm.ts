// orchestrator/tools/chiefComm.ts — chief <-> chief / chief <-> architect / chief <-> advisor.
// list_projects / set_project_info / talk_to_chief / get_agent_chat /
// report_to_mimar.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { GLOBAL_ID } from "../fleet.js";
import {
  talkToChief,
  projectListText,
  reportToMimar,
  fetchChatHistory,
  resolveAgentPort,
  sendRestartRequest,
} from "../crosschief.js";
import {
  type ToolContext,
  type ChiefSelf,
  ok,
  fail,
} from "./types.js";

export function buildChiefCommTools(ctx: ToolContext, self: ChiefSelf) {
  const { fleet, config, projectId, projectName, registry, emit, markAdvisorInteraction } = ctx;

  const listProjects = tool(
    "list_projects",
    "Lists all Architect projects (name, path, purpose, architecture, run status).",
    {},
    async () => ok(projectListText(fleet, projectId)),
  );

  const setProjectInfo = tool(
    "set_project_info",
    "Saves this project's purpose/architecture info (other chiefs see it).",
    {
      aciklama: z.string().optional(),
      mimari: z.string().optional(),
    },
    async (args) => {
      config.setInfo(args.aciklama, args.mimari);
      return ok("Project info updated.");
    },
  );

  const talkToChiefTool = tool(
    "talk_to_chief",
    // Fix 130: shortened — the advisor handoff rule/cost/example is in prompts.ts.
    "Talk to another chief OR an advisor. proje = project_id (e.g. 'volpora') OR an advisor key (seo|pazarlama|trading|sosyal-medya|uxtasarim|hukuk|veri|finans|devops|muhasebe|siber-guvenlik).",
    { proje: z.string(), mesaj: z.string() },
    async (args) => {
      // Fix 131: kaynak (the real sending chief's name) added to the payload. The "Between
      // chiefs" panel in the UI showed the sender as a fixed "Mimar"; now the calling
      // chief's name (projectName) goes as the real source.
      emit("sefler_arasi", { kaynak: projectName, hedef: args.proje, mesaj: args.mesaj });
      // Fix 54: caller identity in a single object. projectId+projectName always set;
      // sessionId optional (the advisor session info may be absent).
      // Fix 82: kind="advisor" for the advisor process — previously it was always sent as
      // "sef". So an advisor self-call (Finans session 2 -> Finans session 1) could not be
      // caught. projectId pattern: __advisor_<key>__
      const isAdvisorCaller = self.isAdvisor;
      const advisorKey = isAdvisorCaller
        ? projectId.replace(/^__advisor_/, "").replace(/__$/, "")
        : undefined;
      const caller = {
        kind: (self.isMimar ? "mimar" : isAdvisorCaller ? "advisor" : "sef") as
          | "mimar"
          | "sef"
          | "advisor",
        name: projectName,
        projectId,
        advisorKey,
      };
      const r = await talkToChief(fleet, caller, args.proje, args.mesaj);
      // Fix 131: kaynak = the real sending chief's name (not relay/Mimar).
      emit("sefler_arasi", {
        kaynak: projectName,
        hedef: r.hedef,
        mesaj: args.mesaj,
        cevap: r.text,
        isError: !r.ok,
        cost: r.cost,
      });
      // M5: an error on the target agent (timeout / lost turn / connection)? Report to the
      // architect — it may be a systemic problem (the orchestrator went down, the queue
      // got stuck, etc). The architect does automatic diagnosis + fix based on the report.
      // Fix 48: a SELF-call error (You cannot talk to your own project) should NOT be
      // reported to the architect — the user cannot fix it and it busies the architect for
      // nothing. The chief prompt gives enough guidance; it is not expected to repeat.
      const isSelfCallError = /KENDINE\s+CAGRI\s+YASAK|Kendi\s+projenle/i.test(r.text);
      if (!r.ok && !self.isMimar && !isSelfCallError) {
        try {
          await reportToMimar(
            caller,
            `talk_to_chief("${args.proje}") failed. Error: ${r.text}. ` +
              `Message: ${args.mesaj.slice(0, 200)}. The target agent may have a health issue, check it.`,
          );
        } catch {
          /* if the architect is unreachable, pass silently */
        }
      }
      // Interaction with an advisor → trigger auto-compact at the end of the turn. The
      // advisor replies are long, clean up before bloating the project chief's context.
      if (r.isAdvisor) markAdvisorInteraction?.();
      return r.ok
        ? ok(`[Reply from chief ${r.hedef}]\n${r.text}`)
        : fail(r.text);
    },
  );

  // Fix 55: get_agent_chat — any agent can see the chat history of a desired agent (project
  // chief/advisor/architect). Critical for error diagnosis, behavior monitoring, workflow
  // understanding. sessionId optional (if absent, all sessions); limit optional (if absent,
  // all entries). Detailed — tool activity + cost.
  const getAgentChatTool = tool(
    "get_agent_chat",
    // Fix 130: shortened — examples/usage in prompts.ts.
    "Get an agent's chat history. agent = local specialist name | project_id | advisor_key | mimar. limit = last N messages (default 40, max 500).",
    {
      agent: z.string().describe("Target: a local specialist name OR a project_id (e.g. 'volpora') OR an advisor_key (e.g. 'seo') OR 'mimar'."),
      sessionId: z.string().optional().describe("A specific session id (if absent, all sessions)"),
      limit: z.number().int().min(1).max(500).optional().describe("Last N messages (default 40 ~ last 20 turns; max 500)"),
    },
    async (args) => {
      try {
        // Fix 104: check a local specialist first. resolveAgentPort only scans the fleet
        // (other project chiefs/advisors); a specialist is inside the registry — not in the
        // fleet. Previously a local-specialist query like google_maps_otomasyon returned
        // "Agent not found".
        if (registry.get(args.agent)) {
          const def = registry.get(args.agent)!;
          const allChat = def.chat ?? [];
          const effLimit = args.limit ?? 40;
          const slice = allChat.slice(-effLimit);
          const payload = {
            projectName: projectName,
            projectId: projectId,
            agentKind: "specialist" as const,
            agentName: def.name,
            agentRole: def.role,
            agentModel: def.model,
            totalEntries: allChat.length,
            shownEntries: slice.length,
            chat: slice,
          };
          const ozet = `Local specialist: ${def.name} (${def.role}) — ${slice.length}/${allChat.length} entries`;
          return ok(`${ozet}\n\n${JSON.stringify(payload, null, 2)}`);
        }
        const target = await resolveAgentPort(fleet, args.agent);
        if (!target) return fail(`Agent not found: ${args.agent}. Must be a local specialist (\`list_agents\` -> specialists) or a fleet target (project_id/advisor_key/mimar).`);
        // Fix 65: token saving — if no limit is given, default 40 messages (~20 turns).
        // Old behavior: all history -> 200+ messages, 40k+ tokens. Most calls only need
        // info from the last few turns. For the old full-history, explicitly give limit=500.
        const effLimit = args.limit ?? 40;
        const r = await fetchChatHistory(target.port, { sessionId: args.sessionId, limit: effLimit });
        if (!r.ok) return fail(r.hata ?? "Could not get chat history");
        // Return JSON — the chief parses and uses it. It can be large, the summary part is
        // at the start.
        const payload = r.sonuc as {
          projectName: string;
          projectId: string;
          totalSessions: number;
          sessions: Array<{
            sessionId: string;
            sessionName: string;
            totalEntries: number;
            shownEntries: number;
            chat: unknown[];
          }>;
        };
        const ozet = `Target: ${target.name} (${payload.totalSessions} sessions). ${
          payload.sessions.map((s) => `[${s.sessionName}] ${s.shownEntries}/${s.totalEntries} entries`).join(", ")
        }`;
        return ok(`${ozet}\n\n${JSON.stringify(payload, null, 2)}`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const reportToMimarTool = tool(
    "report_to_mimar",
    "Reports to the architect when you notice a problem/gap in the Architect infrastructure. Only for system problems.",
    { sorun: z.string() },
    async (args) => {
      if (projectId === GLOBAL_ID) {
        return fail("The architect cannot send a report to itself — handle the problem directly.");
      }
      // Fix 131: kaynak = the reporting chief's name (the target is always the architect).
      emit("sefler_arasi", { kaynak: projectName, hedef: "Mimar", mesaj: args.sorun });
      // Fix 54: the caller identity is added to the start of the message by the system.
      // Fix: kind was hardcoded "sef" — when an advisor called report_to_mimar the
      // architect was shown "Type: Project Chief". Same derivation as talk_to_chief: the
      // advisor projectId pattern __advisor_<key>__ -> kind="advisor".
      const isAdvisorReporter = self.isAdvisor;
      const reporterAdvisorKey = isAdvisorReporter
        ? projectId.replace(/^__advisor_/, "").replace(/__$/, "")
        : undefined;
      const r = await reportToMimar(
        {
          kind: (isAdvisorReporter ? "advisor" : "sef") as "advisor" | "sef",
          name: projectName,
          projectId,
          advisorKey: reporterAdvisorKey,
        },
        args.sorun,
      );
      // Fix 131: kaynak = the reporting chief's name.
      emit("sefler_arasi", {
        kaynak: projectName,
        hedef: "Mimar",
        mesaj: args.sorun,
        cevap: r.text,
        isError: !r.ok,
      });
      return r.ok ? ok(`[The architect's reply]\n${r.text}`) : fail(r.text);
    },
  );

  // Architect — restarts a single agent (project chief OR advisor) in a supervised way.
  // Refreshes a stuck/broken/updated agent on its own without interrupting the whole
  // ecosystem (rebuild_ui). The target agent receives the restart_iste WS message and
  // triggers its own supervisor restart flow (rolls back to the last good version if it
  // cannot come up in 45s). The cross-agent equivalent of restart_self.
  const restartAgentTool = tool(
    "restart_agent",
    "Restarts a single agent (project chief OR advisor) in a supervised way. ARCHITECT ONLY. agent = project_id (e.g. 'volpora') OR an advisor key (e.g. 'seo'). devam_gorevi: the remaining work the target's new process will autonomously continue. For refreshing a stuck/broken agent on its own — rebuild_ui interrupts the whole ecosystem, this does not.",
    {
      agent: z.string().describe("Target: a project_id (e.g. 'volpora') OR an advisor key (e.g. 'seo')."),
      not: z.string().optional().describe("A short note left for the new process."),
      devam_gorevi: z.string().optional().describe("The remaining work the target's new process will autonomously continue."),
    },
    async (args) => {
      if (!self.isMimar) {
        return fail(
          "restart_agent is an architect-only authority. A chief/advisor refreshes itself with `restart_self`; for another agent report to the architect with `report_to_mimar`.",
        );
      }
      const q = args.agent.trim().toLowerCase();
      if (q === "mimar" || q === "global" || q === "__global__") {
        return fail("The architect cannot refresh itself with restart_agent — use `restart_self`.");
      }
      const target = await resolveAgentPort(fleet, args.agent);
      if (!target) {
        return fail(`Agent not found: ${args.agent}. Must be a project_id (e.g. 'volpora') or an advisor key (e.g. 'seo').`);
      }
      emit("sefler_arasi", {
        kaynak: projectName,
        hedef: target.name,
        mesaj: "[restart_agent] supervised restart request",
      });
      const r = await sendRestartRequest(target.port, { not: args.not, devamGorevi: args.devam_gorevi });
      emit("sefler_arasi", {
        kaynak: projectName,
        hedef: target.name,
        mesaj: "[restart_agent]",
        cevap: r.ok ? "restart accepted" : (r.hata ?? "error"),
        isError: !r.ok,
      });
      return r.ok
        ? ok(
            `${target.name} is being restarted in a supervised way. The new process comes up in ~5-10s; ` +
              `if it cannot come up in 45s, automatic rollback to the last good version. If devam_gorevi is given, the new process continues it autonomously.`,
          )
        : fail(`${target.name} could not be restarted: ${r.hata}`);
    },
  );

  return [listProjects, setProjectInfo, talkToChiefTool, getAgentChatTool, reportToMimarTool, restartAgentTool];
}
