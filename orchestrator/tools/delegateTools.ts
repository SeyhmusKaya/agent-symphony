// orchestrator/tools/delegateTools.ts — cross-agent / remote agent communication.
//
// F1.3a (Option B): the chief now spawns specialists via the native Agent tool. The
// subprocess-based delegate / background_delegate / request_from_peer were removed. The
// local-specialist branch of message_agent was removed (done via Agent); only the
// cross-agent WS path (advisor / project_id / mimar) remains.
// F1.3b: list_background_tasks and the bgTasks ctx field were completely removed.
// call_remote_agent: unrelated to subprocesses, preserved.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { resolveAgentPort, sendCommandAwait } from "../crosschief.js";
import { callRemoteAgent } from "../remote.js";
import {
  type ToolContext,
  type ChiefSelf,
  ok,
  fail,
} from "./types.js";

export function buildDelegateTools(
  ctx: ToolContext,
  self: ChiefSelf,
) {
  const {
    emit,
    fleet,
    projectId,
    projectName,
    registry,
  } = ctx;

  const messageAgent = tool(
    "message_agent",
    // Fix 130: shortened — sibling of talk_to_chief; for a local specialist use the Agent tool.
    "Sends a cross-chief/advisor message, returns the reply. agent = advisor key | project_id | 'mimar'/'global'. For a local specialist use the Agent tool.",
    { agent: z.string(), message: z.string() },
    async (args) => {
      emit("delege_basladi", { agent: args.agent, task: args.message });
      try {
        const target = await resolveAgentPort(fleet, args.agent);
        if (!target) {
          emit("delege_bitti", { agent: args.agent, isError: true });
          return fail(
            `Agent not found: ${args.agent}. ` +
              `Must be an advisor key (seo|pazarlama|...) or a project_id. ` +
              `For messaging local specialists use the native Agent tool. ` +
              `See available targets with list_agents / list_projects.`,
          );
        }
        const caller = {
          kind: (self.isMimar ? "mimar" : "sef") as "mimar" | "sef",
          name: projectName,
          projectId,
        };
        const reply = await sendCommandAwait(target.port, args.message, caller);
        emit("delege_bitti", { agent: args.agent, isError: false });
        return ok(`[Reply from ${target.name}]\n${reply.text}`);
      } catch (e) {
        emit("hata", { agent: args.agent, mesaj: (e as Error).message });
        emit("delege_bitti", { agent: args.agent, isError: true });
        return fail((e as Error).message);
      }
    },
  );

  const callRemote = tool(
    "call_remote_agent",
    "Sends a message to a remote agent (HTTP or WebSocket endpoint).",
    {
      endpoint: z.string(),
      message: z.string(),
      auth_token: z.string().optional(),
      auth_header: z.string().optional(),
    },
    async (args) => {
      emit("peer_istek", { peer: args.endpoint, request: args.message });
      const res = await callRemoteAgent(args.endpoint, args.message, {
        token: args.auth_token,
        header: args.auth_header,
      });
      return res.ok ? ok(res.response) : fail(res.response);
    },
  );

  // Fix 138 (Async delegation C): delege_arkaplan — runs the specialist in the BACKGROUND
  // (fire-and-forget). Returns INSTANTLY, the chief turn closes (user free); when the
  // specialist finishes the host enqueues a resume turn on the SAME session (result in a
  // new turn). This tool only VALIDATES + returns an ack — the real job is started by
  // runChiefAttempt (in the tool_use detection sid is in scope; the tool has none). DO NOT
  // USE background:true. Flag ARCHITECT_ASYNC_DELEGE=1 + only the project chief (not
  // architect/advisor).
  const asyncDelegeAktif =
    process.env.ARCHITECT_ASYNC_DELEGE === "1" && !self.isMimar && !self.isAdvisor;
  const delegeArkaplan = tool(
    "delege_arkaplan",
    "Runs the specialist in the BACKGROUND (for long work). Returns INSTANTLY -> you become free, " +
      "you can keep talking to the user. When the specialist finishes the result comes to you in a SEPARATE turn; " +
      "in that turn you relay it to the user/continue if needed. Do short/quick work with the normal 'Agent' tool " +
      "(blocking); only delegate work that will take 2+ min via delege_arkaplan. uzman = the registered specialist name.",
    { uzman: z.string(), gorev: z.string() },
    async (args) => {
      const spec = registry.get(args.uzman);
      if (!spec) {
        const mevcut = registry.list().map((s) => s.name).join(", ") || "(none)";
        return fail(
          `Specialist not found: ${args.uzman}. Registered specialists: ${mevcut}. ` +
            `See details with list_agents.`,
        );
      }
      emit("delege_basladi", { agent: args.uzman, task: args.gorev });
      return ok(
        `[BACKGROUND TASK ACCEPTED — specialist: ${args.uzman}]\n` +
          `The task was started in the background. You are NOW FREE: close this turn, ` +
          `briefly tell the user "I delegated this to specialist X in the background, I'll let you know when done". ` +
          `When the specialist finishes the result will reach you in a SEPARATE turn. Do NOT delegate the same task AGAIN.`,
      );
    },
  );

  return [
    messageAgent,
    callRemote,
    ...(asyncDelegeAktif ? [delegeArkaplan] : []),
  ];
}
