// orchestrator/tools/agentTools.ts — specialist registry management tools.
// create_agent / list_agents / remove_agent / set_agent_model / load_skill
// export_agent / import_agent / list_templates.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Effort } from "../registry.js";
import { specialistToMarkdown, markdownToSpecialist } from "../agentmd.js";
import { SPECIALIST_TEMPLATES, getTemplate } from "../templates.js";
import { ADVISORS, ADVISOR_TOOLS, getAdvisorUzmanlik, resolveAdvisor } from "../advisors.js";
import {
  attachSkill as fsAttachSkill,
  detachSkill as fsDetachSkill,
  listSkillRoles as fsListSkillRoles,
  loadSkills as fsLoadSkills,
} from "../skills.js";
import {
  type ToolContext,
  type ChiefSelf,
  ok,
  fail,
  GIT_YASAK,
} from "./types.js";

export function buildAgentTools(ctx: ToolContext, self: ChiefSelf) {
  const { registry, emit, refreshStatus, getSessionModel, projectId, projectName, autonomousManager, budgetManager } = ctx;

  const createAgent = tool(
    "create_agent",
    "Creates a new persistent specialist agent. For a ready template provide `template`. SKILL INHERITANCE: first see the advisors (name+expertise+skills) with `list_agents`; pick a suitable one and inherit ALL of that advisor's skills with `inherit_skills_from`, or inherit only the skill names you want with `skills`. If none is given, it auto-matches if the role/name resembles an advisor (fuzzy fallback).",
    {
      name: z.string(),
      role: z.string().optional(),
      system_prompt: z.string().optional(),
      template: z.string().optional(),
      allowed_tools: z.array(z.string()).optional(),
      model: z.string().optional(),
      effort: z.enum(["low", "medium", "high"]).optional(),
      // Skill devralma — explicit secim (fuzzy auto-match'ten oncelikli).
      inherit_skills_from: z
        .string()
        .optional()
        .describe("Advisor key (e.g. 'uxtasarim','seo','siber-guvenlik'). ALL of that advisor's skills are inherited. See the list with list_agents."),
      skills: z
        .array(z.string())
        .optional()
        .describe("A direct skill name list (fine-tuning). If given, overrides inherit_skills_from."),
    },
    async (args) => {
      try {
        const tpl = args.template ? getTemplate(args.template) : undefined;
        if (args.template && !tpl) {
          return fail(`Template not found: ${args.template}`);
        }
        const role = args.role ?? tpl?.role;
        const systemPrompt = args.system_prompt ?? tpl?.systemPrompt;
        if (!role || !systemPrompt) {
          return fail("role + system_prompt or a valid template is required.");
        }
        // Skill inheritance — priority order:
        //   1) args.skills      : the chief gave skill names directly (most explicit).
        //   2) inherit_skills_from: if the chief picked an advisor key, ALL of that
        //      advisor's skills. The chief sees the list with list_agents and picks by
        //      name — it does not rely on name guessing (fuzzy), it consciously picks the
        //      right advisor.
        //   3) fuzzy fallback   : if none is given, auto-matches if the role/name resembles
        //      an advisor (resolveAdvisor substring).
        let inheritedSkills: string[] = [];
        let skillKaynak = "";
        if (args.skills && args.skills.length) {
          inheritedSkills = args.skills;
          skillKaynak = "direct";
        } else if (args.inherit_skills_from) {
          const adv = resolveAdvisor(args.inherit_skills_from);
          if (!adv) {
            return fail(
              `inherit_skills_from invalid: "${args.inherit_skills_from}". For a valid advisor key run list_agents first.`,
            );
          }
          try {
            inheritedSkills = fsLoadSkills(`advisor-${adv.key}`).map((s) => s.name);
          } catch {
            inheritedSkills = [];
          }
          skillKaynak = `advisor ${adv.key}`;
        } else {
          const matchedAdvisor = resolveAdvisor(role) ?? resolveAdvisor(args.name);
          if (matchedAdvisor) {
            try {
              inheritedSkills = fsLoadSkills(`advisor-${matchedAdvisor.key}`).map((s) => s.name);
            } catch {
              inheritedSkills = [];
            }
            if (inheritedSkills.length) skillKaynak = `advisor ${matchedAdvisor.key} (auto-match)`;
          }
        }
        const def = registry.create({
          name: args.name,
          role,
          systemPrompt: systemPrompt + GIT_YASAK,
          allowedTools: args.allowed_tools,
          model: args.model,
          effort: args.effort as Effort | undefined,
          skills: inheritedSkills.length ? inheritedSkills : undefined,
        });
        emit("ajan_durum_degisti", { agent: def.name, durum: "olusturuldu" });
        refreshStatus?.();
        const skillNote = inheritedSkills.length
          ? ` — ${skillKaynak}: ${inheritedSkills.length} skills (${inheritedSkills.join(", ")})`
          : "";
        return ok(`Specialist created: ${def.name} (${def.model}, ${def.effort})${skillNote}`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const listAgents = tool(
    "list_agents",
    "Lists all persistent specialists. Shows both project-specific specialists and system-wide advisors.",
    {},
    async () => {
      // P1.25: the architect + project chief list_agents showed only the project
      // specialists in the registry. Also add the 11 advisors from the ADVISORS constant
      // so the architect knows it can reach them via talk_to_chief.
      const specialists = registry.list().map((d) => ({
        name: d.name,
        role: d.role,
        model: d.model,
        effort: d.effort,
        skills: d.skills,
        type: "specialist",
        // Fix 84: specialists' SDK tool set too (default specialist hooks). So the calling
        // agent sees what they can do.
        tools: ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "WebFetch", "NotebookEdit"],
        mcpServers: ["codegraph"],
        nasilCagrilir: `delegate("${d.name}", "<task>")`,
      }));
      const advisorList = ADVISORS.map((a) => {
        // Fix 84: expertise field + tools list. The calling agent (chief/architect/another
        // advisor) sees it in advance and routes the question to the right advisor.
        const uzmanlik = getAdvisorUzmanlik(a);
        // Summary for a long expertise (sosyal-medya 3k+ chars, siber-guvenlik similar):
        // first 600 chars + "... (ask the advisor for the full)" / short ones in full.
        const uzmanlikOzet = uzmanlik.length > 600
          ? uzmanlik.slice(0, 600).trim() + "... (ask the advisor for the full expertise)"
          : uzmanlik;
        // F2: skill names in the advisor-<key> role folder (if any). The architect sees
        // which advisor works with which skill set.
        const advisorSkills = fsLoadSkills(`advisor-${a.key}`).map((s) => s.name);
        return {
          name: a.name,
          key: a.key,
          port: a.port,
          type: "advisor",
          uzmanlik: uzmanlikOzet,
          // Like specialists' skills field: active capabilities.
          // Advisors get the Architect default SDK tool set + MCP architect server.
          tools: ADVISOR_TOOLS,
          skills: advisorSkills,
          mcpServers: ["architect"],
          nasilCagrilir: `talk_to_chief("${a.key}", "<question>")`,
        };
      });
      // Fix 89: self field — the caller (architect / chief / advisor) should also see its
      // own tool set. The old list returned only specialists + advisors; the caller was
      // missing the "which tools can I work with?" info. The SDK tools list must be kept
      // exactly in sync with main.ts:1656-1658 — chief 8, advisor 9 tools. Fixed for cache
      // prefix stability.
      const selfTools = self.isAdvisor
        ? ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "WebSearch", "WebFetch", "NotebookEdit"]
        : ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "WebFetch", "NotebookEdit"];
      // MCP server list: all roles connect to the architect MCP server (chiefTools/
      // codeGraphTools in a single server). codegraph is shown as a "logical" separate
      // name for the project chief and advisor — tied to project code. The architect
      // (global) has no project code → no codegraph.
      const selfMcp: string[] = ["architect"];
      if (!self.isMimar) selfMcp.push("codegraph");
      const selfModel = getSessionModel?.() ?? "";
      const selfPayload = {
        name: projectName,
        kind: self.kind,
        projectId,
        tools: selfTools,
        mcpServers: selfMcp,
        model: selfModel,
      };
      return ok(
        JSON.stringify(
          {
            self: selfPayload,
            specialists,
            advisors: advisorList,
            ozet:
              `1 self (${self.kind}: ${projectName}) + ${specialists.length} specialists + ${advisorList.length} advisors accessible.`,
          },
          null,
          2,
        ),
      );
    },
  );

  const removeAgent = tool(
    "remove_agent",
    "Deletes a persistent specialist (removes it from the registry, the session is terminated).",
    { name: z.string() },
    async (args) => {
      try {
        // F1.3b: killSpecialist removed (no specialist subprocess). The native Agent tool
        // spawns are part of the chief SDK turn; deleting an agent needs no special
        // interrupt — dropping it from the registry is enough.
        registry.remove(args.name);
        emit("ajan_durum_degisti", { agent: args.name, durum: "silindi" });
        refreshStatus?.();
        return ok(`Specialist deleted: ${args.name}`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const setAgentModel = tool(
    "set_agent_model",
    "Changes a specialist's model and/or effort setting.",
    {
      agent: z.string(),
      model: z.string().optional(),
      effort: z.enum(["low", "medium", "high"]).optional(),
    },
    async (args) => {
      try {
        registry.updateModel(args.agent, args.model, args.effort as Effort | undefined);
        const def = registry.get(args.agent)!;
        emit("ajan_durum_degisti", { agent: args.agent, durum: "model_degisti" });
        return ok(`Updated: ${def.name} (${def.model}, ${def.effort})`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const loadSkill = tool(
    "load_skill",
    "Loads a skill onto a specific specialist.",
    { agent: z.string(), skill: z.string() },
    async (args) => {
      try {
        const def = registry.get(args.agent);
        if (!def) return fail(`Specialist not found: ${args.agent}`);
        if (!def.skills.includes(args.skill)) {
          registry.updateSkills(args.agent, [...def.skills, args.skill]);
        }
        emit("ajan_durum_degisti", { agent: args.agent, durum: "skill_yuklendi", skill: args.skill });
        return ok(`Skill loaded: ${args.skill} -> ${args.agent}`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const exportAgent = tool(
    "export_agent",
    "Returns a specialist in Claude Code-compatible .md frontmatter format.",
    { agent: z.string() },
    async (args) => {
      const def = registry.get(args.agent);
      if (!def) return fail(`Specialist not found: ${args.agent}`);
      return ok(specialistToMarkdown(def));
    },
  );

  const importAgent = tool(
    "import_agent",
    "Creates a specialist from Claude Code-compatible .md frontmatter text.",
    { markdown: z.string() },
    async (args) => {
      try {
        const input = markdownToSpecialist(args.markdown);
        const def = registry.create({
          ...input,
          systemPrompt: input.systemPrompt + GIT_YASAK,
        });
        emit("ajan_durum_degisti", { agent: def.name, durum: "olusturuldu" });
        refreshStatus?.();
        return ok(`Specialist imported: ${def.name} (${def.model}, ${def.effort})`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const listTemplates = tool(
    "list_templates",
    "Lists the ready specialist templates (use as `template` in create_agent).",
    {},
    async () => {
      const list = SPECIALIST_TEMPLATES.map((t) => ({ key: t.key, name: t.name, role: t.role }));
      return ok(JSON.stringify(list, null, 2));
    },
  );

  // F2 (master plan section 3): per-role skill yonetimi.
  // Skill layout: ~/.architect/skills/{global|mimar|advisor-<key>|sef-<projectId>}/<skill>/SKILL.md
  // SDK AgentDefinition.skills field uzerinden subagent context'e yuklenir.
  const attachSkillTool = tool(
    "attach_skill",
    "Adds a skill to a role (global|mimar|advisor-<key>|sef-<projectId>). If source is given the SKILL.md at that path is copied; if not, a skeleton is created (fill it later with Edit).",
    {
      role: z.string().describe("global | mimar | advisor-<key> | sef-<projectId>"),
      skill_name: z.string().describe("Skill folder name (A-Za-z0-9_.-)"),
      source_path: z.string().optional().describe("A SKILL.md or skill folder to copy from outside"),
    },
    async (args) => {
      try {
        const s = fsAttachSkill(args.role, args.skill_name, args.source_path);
        emit("ajan_durum_degisti", {
          agent: `skill:${args.role}/${args.skill_name}`,
          durum: "skill_eklendi",
        });
        return ok(`Skill added: ${s.role}/${s.name} (${s.path})`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const detachSkillTool = tool(
    "detach_skill",
    "Deletes a skill folder from a role. SAFE: no-op if absent.",
    {
      role: z.string().describe("global | mimar | advisor-<key> | sef-<projectId>"),
      skill_name: z.string().describe("The skill name to delete"),
    },
    async (args) => {
      try {
        fsDetachSkill(args.role, args.skill_name);
        emit("ajan_durum_degisti", {
          agent: `skill:${args.role}/${args.skill_name}`,
          durum: "skill_silindi",
        });
        return ok(`Skill deleted: ${args.role}/${args.skill_name}`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const listSkillsTool = tool(
    "list_skills",
    "Lists the skill catalog. If role is given, only that role's skills; if not, the whole role/skill tree.",
    {
      role: z.string().optional().describe("A specific role (global|mimar|advisor-<key>|sef-<projectId>)"),
    },
    async (args) => {
      try {
        if (args.role) {
          const list = fsLoadSkills(args.role).map((s) => ({
            name: s.name,
            description: s.description,
            path: s.path,
          }));
          return ok(JSON.stringify({ role: args.role, skills: list }, null, 2));
        }
        const roles = fsListSkillRoles().map((r) => ({
          role: r.role,
          skills: r.skills.map((s) => ({ name: s.name, description: s.description, path: s.path })),
        }));
        return ok(JSON.stringify({ roles }, null, 2));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  // F3 (Autonomous 3-Day Mode): autonomous job management. The chief starts a multi-day
  // task like "rewrite the checkout page from scratch, gone for 3 days" with
  // start_autonomous_job; the AutonomousManager handles checkpoint commits, the error
  // counter, and notification management.
  const startAutonomousJob = tool(
    "start_autonomous_job",
    // Fix 130: shortened.
    "Starts a multi-day autonomous job (plan + parallel specialists + periodic commit, notify when done). maxDays upper limit 7.",
    {
      task: z.string().describe("The text definition of the autonomous task"),
      max_days: z.number().min(1).max(14).describe("Maximum duration (days, 1-7 recommended)"),
      notify_on_complete: z.boolean().optional().describe("Notify when done (default true)"),
    },
    async (args) => {
      const mgr = autonomousManager?.();
      if (!mgr) return fail("Autonomous mode is not configured (available for architect/chief).");
      try {
        const { jobId } = mgr.startJob({
          task: args.task,
          maxDays: args.max_days,
          notifyOnComplete: args.notify_on_complete ?? true,
        });
        refreshStatus?.();
        return ok(`Autonomous job started: ${jobId} (${args.max_days} days)`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const pauseAutonomousJob = tool(
    "pause_autonomous_job",
    "Temporarily pauses a running autonomous job. Can be resumed with resume_autonomous_job.",
    { job_id: z.string() },
    async (args) => {
      const mgr = autonomousManager?.();
      if (!mgr) return fail("Autonomous mode is not configured.");
      try {
        const job = mgr.pauseJob(args.job_id);
        refreshStatus?.();
        return ok(`Paused: ${job.id} (status: ${job.status})`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const resumeAutonomousJob = tool(
    "resume_autonomous_job",
    "Resumes a paused autonomous job.",
    { job_id: z.string() },
    async (args) => {
      const mgr = autonomousManager?.();
      if (!mgr) return fail("Autonomous mode is not configured.");
      try {
        const job = mgr.resumeJob(args.job_id);
        refreshStatus?.();
        return ok(`Resuming: ${job.id} (status: ${job.status})`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const cancelAutonomousJob = tool(
    "cancel_autonomous_job",
    "Permanently cancels an autonomous job. Keeps the counts, starts no more turns.",
    { job_id: z.string() },
    async (args) => {
      const mgr = autonomousManager?.();
      if (!mgr) return fail("Autonomous mode is not configured.");
      try {
        const job = mgr.cancelJob(args.job_id);
        refreshStatus?.();
        return ok(`Cancelled: ${job.id}`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const listAutonomousJobs = tool(
    "list_autonomous_jobs",
    "Lists all autonomous jobs with status/duration/commit/cost counts.",
    {},
    async () => {
      const mgr = autonomousManager?.();
      if (!mgr) return fail("Autonomous mode is not configured.");
      try {
        const jobs = mgr.listJobs().map((j) => ({
          id: j.id,
          task: j.task.slice(0, 120),
          status: j.status,
          maxDays: j.maxDays,
          startedAt: j.startedAt,
          finishedAt: j.finishedAt ?? null,
          commitsMade: j.commitsMade,
          filesChangedTotal: j.filesChangedTotal,
          costUsdTotal: j.costUsdTotal,
          turnsTotal: j.turnsTotal,
        }));
        return ok(JSON.stringify({ jobs, ozet: `${jobs.length} autonomous jobs` }, null, 2));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  // F4 (Cost Control): budget report and cap setting.
  const getBudgetReport = tool(
    "get_budget_report",
    "Daily budget report: USD spent per agent, cap, % usage, top-5 spenders, hourly burn-rate.",
    {},
    async () => {
      const mgr = budgetManager?.();
      if (!mgr) return fail("BudgetManager is not configured.");
      try {
        const r = mgr.getReport();
        return ok(JSON.stringify(r, null, 2));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const setBudgetCap = tool(
    "set_budget_cap",
    "Sets a per-role daily USD cap. role: 'chief'|'mimar'|'specialist'|'advisor'|'worker'. capUsd >= 0.",
    {
      role: z.enum(["chief", "mimar", "specialist", "advisor", "worker"]),
      capUsd: z.number().nonnegative(),
    },
    async (args) => {
      const mgr = budgetManager?.();
      if (!mgr) return fail("BudgetManager is not configured.");
      try {
        const patch: Partial<import("../budgetManager.js").BudgetConfig> = {};
        if (args.role === "chief") patch.perChiefDailyUsd = args.capUsd;
        else if (args.role === "mimar") patch.perMimarDailyUsd = args.capUsd;
        else patch.perAgentDailyUsd = args.capUsd; // specialist/advisor/worker single pool
        const updated = mgr.updateConfig(patch);
        refreshStatus?.();
        emit("butce_cap_degisti", { role: args.role, capUsd: args.capUsd });
        return ok(`Cap updated: ${args.role}=$${args.capUsd}. Active config: ${JSON.stringify(updated)}`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  return [
    createAgent,
    listAgents,
    removeAgent,
    setAgentModel,
    loadSkill,
    exportAgent,
    importAgent,
    listTemplates,
    attachSkillTool,
    detachSkillTool,
    listSkillsTool,
    // F3 (autonomous 3-day mode)
    startAutonomousJob,
    pauseAutonomousJob,
    resumeAutonomousJob,
    cancelAutonomousJob,
    listAutonomousJobs,
    // F4 (Cost Control)
    getBudgetReport,
    setBudgetCap,
  ];
}
