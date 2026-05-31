// orchestrator/tools/index.ts — buildChiefTools: the aggregation point combining 14
// category modules. The old tools.ts was 2010 lines; this index is ~80 lines + 14 modules
// x ~100 lines on average.
//
// API stability: the old `import { buildChiefTools } from "./tools.js"` keeps working —
// tools.ts shim re-export.

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { buildCodeGraphTools } from "../codegraph/mcpTools.js";
import {
  type ToolContext,
  type RecordUsageFn,
  selfFromContext,
} from "./types.js";
// F1.3b: recordUsage is still used by spawn_worker/task; delegateTools no longer records
// tokens (the Agent tool's own usage is included in the chief turn's).
import { buildAgentTools } from "./agentTools.js";
import { buildDelegateTools } from "./delegateTools.js";
import { buildWorkerTools } from "./workerTools.js";
import { buildGitTools } from "./gitTools.js";
// The memory tools (memory_set/get/remember/search/forget/done) were REMOVED by user
// request — memory management was problematic, the [CRITICAL CONTEXT] compact block
// already serves as conversation memory.
import { buildNoteTools } from "./noteTools.js";
import { buildCatalogTools } from "./catalogTools.js";
import { buildDiagTools } from "./diagTools.js";
import { buildPluginMcpTools } from "./pluginMcpTools.js";
import { buildChiefCommTools } from "./chiefComm.js";
import { buildSshTools } from "./sshTools.js";
import { buildVaultTools } from "./vaultTools.js";
import { buildImageTools } from "./imageTools.js";
import { buildSecurityTools } from "./securityTools.js";
import { buildSystemTools } from "./systemTools.js";

export type { ToolContext, EmitFn } from "./types.js";

export function buildChiefTools(ctx: ToolContext) {
  const { usage, emit, codeGraph } = ctx;
  const self = selfFromContext(ctx);

  // recordUsage: a single-point usage.record + emit("token_guncelleme") call. The same
  // callback is passed to all modules for delegate/message_agent/spawn_worker/task — the
  // closure function at the old buildChiefTools lines 304-307.
  const recordUsage: RecordUsageFn = (agent, u) => {
    usage.record(agent, u);
    emit("token_guncelleme", { agent, input: u.input, output: u.output });
  };

  const allTools = [
    // User interaction + media + system calls first — so the architect sees the important
    // ones when quickly scanning the tool list (consistent with the old tools.ts order).
    ...buildSystemTools(ctx), // ask_user_choice, restart_self, rebuild_ui, load/unload_toolset
    ...buildImageTools(ctx), // generate_image, chatgpt_login
    ...buildSecurityTools(ctx), // security_scan
    ...buildAgentTools(ctx, self), // create/list/remove/set_model/skill/export/import/templates
    ...buildDelegateTools(ctx, self), // message_agent / call_remote_agent (F1.3b: bg/list_bg removed)
    ...buildWorkerTools(ctx, recordUsage), // spawn_worker, parallel, task
    ...buildGitTools(ctx), // git_commit, git_push
    // The memory_* tools were removed (user request) — buildMemoryTools is not called.
    ...buildNoteTools(ctx, self), // note_add/list/update/delete/search
    ...buildCatalogTools(ctx), // tool_catalog_add/list/search/remove (ecosystem tool catalog)
    ...buildDiagTools(ctx), // read_logs/log_search/audit_search/daily_report/tool_usage_report
    ...buildPluginMcpTools(ctx), // load/unload/list_plugin, add/list/remove_mcp_server
    ...buildChiefCommTools(ctx, self), // list_projects/set_project_info/talk_to_chief/get_agent_chat/report_to_mimar
    ...buildSshTools(ctx), // ssh_run/ssh_hetzner/list_servers/deploy_project
    ...buildVaultTools(ctx), // vault_set/get/list/delete
    ...buildCodeGraphTools(codeGraph ?? (() => null)),
  ];

  // Item 6: per-turn tool filtering. If allowed is given, ONLY the tools in that set enter
  // the API schema (Anthropic disallowedTools does NOT remove schemas, this method does).
  // main.ts builds the Set per turn's intent; so a variable load like hello->15 tools,
  // ssh->15+4 tools.
  return {
    allTools,
    buildServer(allowed?: Set<string>) {
      const tools = allowed
        ? allTools.filter((t) => allowed.has(t.name))
        : allTools;
      return createSdkMcpServer({
        name: "architect-chief",
        version: "0.1.0",
        tools,
      });
    },
  };
}
