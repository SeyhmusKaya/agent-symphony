// orchestrator/tools/sshTools.ts — registered SSH server command + deploy.
// ssh_run / ssh_hetzner (alias) / list_servers / deploy_project.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { sshExec, listServers as listAllServers, resolveServerId, getServer } from "../ssh.js";
import {
  type ToolContext,
  ok,
  fail,
  capLarge,
  SSH_RESULT_CAP,
} from "./types.js";

export function buildSshTools(ctx: ToolContext) {
  const { fleet } = ctx;

  const sshHetzner = tool(
    "ssh_hetzner",
    "Runs an SSH command on the Hetzner server (alias). In new code use ssh_run.",
    { komut: z.string() },
    async (args) => {
      const id = resolveServerId("hetzner");
      if (!id) return fail("The Hetzner server is not registered. Check with list_servers.");
      const r = await sshExec(id, args.komut);
      return r.ok
        ? ok(capLarge(r.out || "(no output)", SSH_RESULT_CAP))
        : fail(capLarge(`SSH error: ${r.out}`, SSH_RESULT_CAP));
    },
  );

  const sshCalistir = tool(
    "ssh_run",
    "Runs a command on a registered SSH server. serverId = id or alias. List: list_servers.",
    {
      serverId: z.string(),
      komut: z.string(),
      zaman_asimi_sn: z.number().optional(),
    },
    async (args) => {
      const timeout = (args.zaman_asimi_sn ?? 60) * 1000;
      const r = await sshExec(args.serverId, args.komut, timeout);
      const body = [
        `exit=${r.exitCode}`,
        r.stdout ? `--- stdout ---\n${r.stdout}` : "",
        r.stderr ? `--- stderr ---\n${r.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const capped = capLarge(body || "(no output)", SSH_RESULT_CAP);
      return r.ok ? ok(capped) : fail(capped || "SSH error");
    },
  );

  const listeSunucular = tool(
    "list_servers",
    "Lists registered SSH servers. If authReady=true the password/key is registered and ssh_run works directly (do not check the vault). The password/key value is not shown for security.",
    {},
    async () => {
      const list = listAllServers().map((s) => ({
        id: s.id,
        name: s.name,
        host: s.host,
        port: s.port,
        user: s.user,
        authType: s.authType,
        // P1.33: so the chief does not try to check the vault. ssh_run already reads from
        // servers.json and connects with plink -pw "<password>".
        authReady: s.authType === "password" ? !!s.password : !!s.privateKeyPath,
        tags: s.tags,
        panelUrl: s.panelUrl,
      }));
      const hint = list.length
        ? "\n\nNOTE: if authReady=true, ssh_run(serverId, komut) works directly, DO NOT search for the password/key."
        : "";
      return ok(list.length ? JSON.stringify(list, null, 2) + hint : "No registered servers.");
    },
  );

  // User request: the raw SSH password/key path can be given to the agent (and between
  // agents). Non-ssh_run tools like local rsync/scp require the password. Security note:
  // this value returns directly from the vault — the user explicitly allowed it (a
  // single-operator, fully autonomous system).
  const sshSifre = tool(
    "ssh_sifre",
    "Returns the RAW SSH password (or key file path) of a registered server. " +
      "Needed only for non-ssh_run methods (local rsync/scp, manual connection); " +
      "for a normal command ssh_run is enough. serverId = id or alias.",
    { serverId: z.string() },
    async (args) => {
      const id = resolveServerId(args.serverId) ?? args.serverId;
      const srv = getServer(id);
      if (!srv) return fail(`Server not found: ${args.serverId}. Check with list_servers.`);
      if (srv.authType === "password") {
        if (!srv.password) return fail(`No registered password for server '${srv.name}'.`);
        return ok(
          `Server: ${srv.name} (${srv.host}:${srv.port}, user=${srv.user})\n` +
            `Auth: password\nPassword: ${srv.password}`,
        );
      }
      if (!srv.privateKeyPath) return fail(`No registered key for server '${srv.name}'.`);
      return ok(
        `Server: ${srv.name} (${srv.host}:${srv.port}, user=${srv.user})\n` +
          `Auth: key\nPrivate key path: ${srv.privateKeyPath}`,
      );
    },
  );

  const deployProje = tool(
    "deploy_project",
    "Runs deployScript on the project's deployment.serverIds servers. Do not use if mode=local.",
    { projectId: z.string() },
    async (args) => {
      const all = fleet.list();
      const running = all.find((r) => r.projectId === args.projectId);
      // read from projects.json
      const { listAllProjects } = await import("../fleet.js");
      const projects = listAllProjects();
      const proj = projects.find((p) => p.id === args.projectId);
      if (!proj) return fail(`Project not found: ${args.projectId}`);
      const d = proj.deployment;
      if (!d) return fail(`No deployment definition in the project: ${proj.name}`);
      if (d.mode === "local") {
        return fail(`Project '${proj.name}' is in local mode — no server deploy.`);
      }
      if (!d.serverIds?.length) return fail("deployment.serverIds is empty.");
      if (!d.deployScript?.trim()) return fail("deployment.deployScript is empty.");
      const parts: string[] = [`[${proj.name}] deploy starting (${d.serverIds.length} servers)`];
      let allOk = true;
      for (const sid of d.serverIds) {
        const r = await sshExec(sid, d.deployScript, 600000);
        parts.push(
          `\n=== ${sid} (exit=${r.exitCode}) ===\n${r.stdout || ""}${
            r.stderr ? "\n[stderr] " + r.stderr : ""
          }`,
        );
        if (!r.ok) allOk = false;
      }
      void running;
      return allOk ? ok(parts.join("\n")) : fail(parts.join("\n"));
    },
  );

  return [sshHetzner, sshCalistir, listeSunucular, sshSifre, deployProje];
}
