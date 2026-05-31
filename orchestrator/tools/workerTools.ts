// orchestrator/tools/workerTools.ts — one-shot worker / parallel worker / task.
// spawn_worker / spawn_workers_parallel / task. The chief runs small task packages in an
// isolated separate process without bloating its own context.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { spawnWorker, spawnWorkersParallel } from "../worker.js";
import { runTaskAgent } from "../task.js";
import {
  type ToolContext,
  type RecordUsageFn,
  ok,
  fail,
  capDelegate,
} from "./types.js";

export function buildWorkerTools(
  ctx: ToolContext,
  recordUsage: RecordUsageFn,
) {
  const { emit, registry } = ctx;

  const spawnWorkerTool = tool(
    "spawn_worker",
    "Starts a one-shot temporary Haiku worker, returns the result. NOTE: if a specialist exists prefer the Agent tool (shared context, zero cold start). This is only for anonymous quick work.",
    { task: z.string() },
    async (args) => {
      emit("worker_spawn", { task: args.task });
      const res = await spawnWorker(args.task);
      recordUsage("worker", res.usage);
      emit("worker_done", { task: args.task, isError: res.isError, transcript: res.transcript });
      return res.isError ? fail(capDelegate(res.result)) : ok(capDelegate(res.result));
    },
  );

  const spawnWorkersParallelTool = tool(
    "spawn_workers_parallel",
    "Runs multiple anonymous Haiku workers in parallel (concurrency limit 8). DEPRECATED — if a specialist exists prefer the native Agent tool (hundreds in parallel, zero cold start, shared context). This is only for anonymous quick exploration/transformation.",
    { tasks: z.array(z.string()) },
    async (args) => {
      emit("worker_spawn", { count: args.tasks.length });
      const results = await spawnWorkersParallel(args.tasks);
      for (const r of results) recordUsage("worker", r.usage);
      emit("worker_done", { count: results.length });
      // Context isolation: do not return transcript/usage to the chief, only a short
      // result. Truncate each worker output independently — in parallel 8 workers x raw
      // text bloat the chief's window.
      const slim = results.map((r) => ({
        task: r.task,
        result: capDelegate(r.result),
        isError: r.isError,
      }));
      return ok(JSON.stringify(slim, null, 2));
    },
  );

  const taskTool = tool(
    "task",
    // Fix 130: shortened.
    // Fix (specialist delegation): task is an ANONYMOUS/identity-less worker. For work in a
    // REGISTERED specialist's (e.g. ui_tasarim) area THIS TOOL IS FORBIDDEN -> use native Agent.
    "Runs a general-purpose ANONYMOUS task in an isolated context (refactor, multi-file edit, exploration, deep research). Runs with the selected model, returns a short report. WARNING: for work in a REGISTERED specialist's (e.g. ui_tasarim) area DO NOT USE THIS TOOL — use native `Agent(subagent_type=\"<specialist name>\", prompt=<task>)`. Writing 'you are ui_tasarim' in the task DOES NOT RUN the specialist; an identity-less/skill-less/chat-less anonymous worker runs.",
    {
      opis: z.string().describe("Short title, 3-5 words"),
      gorev: z.string().describe("Full task instruction: context + goal + input + output format"),
      model: z.enum(["haiku", "sonnet", "opus"]).optional().default("sonnet"),
    },
    async (args) => {
      // Registry-specialist misuse guard: when the chief writes "SEN <specialist> UZMANISIN"
      // or "subagent_type=<specialist>" and tries to delegate via task (the full misuse
      // pattern) and that name is a REGISTERED specialist, REJECT. task runs an anonymous
      // worker (NO identity/skill/persistent chat) -> redirect to Agent. So the specialist
      // runs with its real identity + is recorded to the registry chat.
      const probe = `${args.opis}\n${args.gorev}`;
      const m =
        /\bSEN\s+["']?([A-Za-z0-9_\-]+)["']?\s+UZMAN/i.exec(probe) ||
        /subagent_type[=:\s"']+([A-Za-z0-9_\-]+)/i.exec(probe);
      if (m) {
        const adi = m[1];
        if (registry.get(adi)) {
          return fail(
            `This work belongs to the REGISTERED specialist "${adi}" area. task runs an anonymous worker ` +
              `(NO identity/skill/persistent chat, writing "SEN ${adi}'sin" DOES NOT RUN it). ` +
              `Use the native Agent tool instead:\n` +
              `Agent(subagent_type="${adi}", prompt=<task text>)\n` +
              `So "${adi}" runs with its real identity + skills and its chat is recorded.`,
          );
        }
      }
      emit("task_basladi", { opis: args.opis, model: args.model ?? "sonnet" });
      const res = await runTaskAgent(args.opis, args.gorev, args.model ?? "sonnet");
      recordUsage("task", { input: res.usage.input, output: res.usage.output });
      emit("task_bitti", { opis: args.opis, isError: res.isError });
      return res.isError ? fail(capDelegate(res.result)) : ok(capDelegate(res.result));
    },
  );

  return [spawnWorkerTool, spawnWorkersParallelTool, taskTool];
}
