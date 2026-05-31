// orchestrator/tools/gitTools.ts — git_commit + git_push.
// Version control is only on the chief; specialists are blocked via GIT_YASAK.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { commitAll, push, formatCommit, type CommitType } from "../git.js";
import { type ToolContext, ok, fail } from "./types.js";

export function buildGitTools(ctx: ToolContext) {
  const { projectRoot, emit } = ctx;

  const gitCommit = tool(
    "git_commit",
    "Commits all changes in Conventional Commits format.",
    {
      type: z.enum(["feat", "fix", "refactor", "chore", "docs", "test"]),
      subject: z.string(),
      body: z.string().optional(),
    },
    async (args) => {
      try {
        const msg = formatCommit(args.type as CommitType, args.subject, args.body);
        const res = commitAll(projectRoot, msg);
        if (!res.committed) return ok("No changes, no commit made.");
        emit("commit", { hash: res.hash, mesaj: res.message });
        return ok(`Commit: ${res.hash} ${res.message.split("\n")[0]}`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  const gitPush = tool(
    "git_push",
    "Pushes the current branch to the remote repo.",
    { remote: z.string().optional(), branch: z.string().optional() },
    async (args) => {
      try {
        const out = push(projectRoot, args.remote, args.branch);
        return ok(out || "Push complete.");
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  return [gitCommit, gitPush];
}
