// orchestrator/tools/pluginMcpTools.ts — Claude Code plugin + MCP server management.
// load_plugin / unload_plugin / list_plugins / add_mcp_server / list_mcp_servers /
// remove_mcp_server.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { setPlugins, getPluginPaths } from "../runtime.js";
import { type ToolContext, ok, fail } from "./types.js";

export function buildPluginMcpTools(ctx: ToolContext) {
  const { config, emit, projectRoot } = ctx;

  const loadPlugin = tool(
    "load_plugin",
    "Loads a Claude Code plugin (agent+command+skill+hook bundle). Provide a local directory path.",
    { path: z.string() },
    async (args) => {
      const abs = isAbsolute(args.path) ? args.path : resolve(projectRoot, args.path);
      if (!existsSync(abs)) return fail(`Plugin directory not found: ${abs}`);
      config.addPlugin(abs);
      setPlugins(config.get().plugins);
      emit("ajan_durum_degisti", { agent: "sef", durum: "eklenti_yuklendi" });
      return ok(`Plugin loaded: ${abs}\n(New specialist/worker runs will use the plugin.)`);
    },
  );

  const unloadPlugin = tool(
    "unload_plugin",
    "Removes a loaded plugin.",
    { path: z.string() },
    async (args) => {
      const abs = isAbsolute(args.path) ? args.path : resolve(projectRoot, args.path);
      config.removePlugin(abs);
      setPlugins(config.get().plugins);
      return ok(`Plugin removed: ${abs}`);
    },
  );

  const listPlugins = tool(
    "list_plugins",
    "Lists loaded plugins.",
    {},
    async () => ok(JSON.stringify(getPluginPaths(), null, 2)),
  );

  const addMcpServer = tool(
    "add_mcp_server",
    "Adds an MCP server (stdio/sse/http). Takes effect with restart_self.",
    {
      ad: z.string(),
      tip: z.enum(["stdio", "sse", "http"]).optional(),
      komut: z.string().optional(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
      url: z.string().optional(),
      header: z.record(z.string(), z.string()).optional(),
    },
    async (args) => {
      const tip = args.tip ?? "stdio";
      let cfg: Record<string, unknown>;
      if (tip === "stdio") {
        if (!args.komut) return fail("'komut' is required for a stdio MCP.");
        cfg = {
          type: "stdio",
          command: args.komut,
          args: args.args ?? [],
          ...(args.env ? { env: args.env } : {}),
        };
      } else {
        if (!args.url) return fail(`'url' is required for a ${tip} MCP.`);
        cfg = {
          type: tip,
          url: args.url,
          ...(args.header ? { headers: args.header } : {}),
        };
      }
      config.addMcp({ name: args.ad, config: cfg });
      return ok(
        `MCP server added (${tip}): ${args.ad}. Run restart_self for it to take effect.`,
      );
    },
  );

  const listMcpServers = tool(
    "list_mcp_servers",
    "Lists the added MCP servers.",
    {},
    async () => {
      const list = config.get().mcpServers;
      return ok(
        list.length
          ? list.map((m) => `- ${m.name}`).join("\n")
          : "No added MCP servers.",
      );
    },
  );

  const removeMcpServer = tool(
    "remove_mcp_server",
    "Removes an added MCP server.",
    { ad: z.string() },
    async (args) => {
      config.removeMcp(args.ad);
      return ok(`MCP server removed: ${args.ad}`);
    },
  );

  return [loadPlugin, unloadPlugin, listPlugins, addMcpServer, listMcpServers, removeMcpServer];
}
