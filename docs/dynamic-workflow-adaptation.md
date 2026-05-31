# Dynamic Workflow Adaptation — Task #98 Planning

On 2026-05-28 Anthropic added **Dynamic Workflows** + **native parallel
subagents** to Claude Code. Architect's spawn_workers_parallel + delegate chain
was made native by Anthropic. Our main differentiator is at risk — we need to adapt.

## 1. Anthropic Native API (verified with sources)

### 1.1 `ClaudeAgentOptions.agents`
The subagent catalog passed into SDK `query()` options:

```ts
agents?: Record<string, AgentDefinition>
```

`AgentDefinition` schema (sdk.d.ts:38-92):

```ts
type AgentDefinition = {
  description: string;          // The sef learns when to use it
  prompt: string;               // Subagent system prompt
  tools?: string[];             // Allowed tools (undefined = inherit from parent)
  disallowedTools?: string[];
  model?: string;               // "sonnet" | "opus" | "haiku" | full ID
  mcpServers?: AgentMcpServerSpec[];
  skills?: string[];
  initialPrompt?: string;       // First user turn if a main-thread agent
  maxTurns?: number;
  background?: boolean;         // true = fire-and-forget non-blocking
  memory?: 'user' | 'project' | 'local';
  effort?: 'low'|'medium'|'high'|'xhigh'|'max'|number;
  permissionMode?: PermissionMode;
  criticalSystemReminder_EXPERIMENTAL?: string;
};
```

### 1.2 `Agent` Tool
The sef calls a subagent via the `Agent` tool. `allowedTools: ["Agent", ...]`
auto-approves. The subagent uses an **isolated context window**; only the result
returns to the parent (not the full context). No cold-start cache waste (shared prefix).

In stream events there is a `parent_tool_use_id` field — the UI can track which
message belongs to which subagent.

### 1.3 Dynamic Workflow Activation
Two paths:
1. The user says "enable dynamic workflow".
2. The `ultracode` setting = `effort: "xhigh"` or `"max"`. Selected from the effort
   menu → Claude automatically writes an orchestration script and spawns hundreds
   of parallel subagents.

Official quote: "Claude dynamically writes orchestration scripts that run tens to
hundreds of parallel subagents in a single session, checking its work before
anything reaches you."

### 1.4 Our Current Structure vs Native

| Feature | Architect (current) | Anthropic Native |
|---------|-------------------|------------------|
| Spawn | runSpecialist subprocess SDK | SDK options.agents + Agent tool |
| Cold start cost | 15-45k cache_create x N (Task #93) | 0 — shared context |
| Persistent | Yes (specialist processes) | No — per-call spawn |
| Parallel limit | spawn_workers_parallel max N=10 | tens to hundreds |
| Tracking | server.ts sendUzman* events | parent_tool_use_id |
| Effort | low/medium/high | low/medium/high/xhigh/max |
| Background | bgTasks (custom) | AgentDefinition.background=true |

**Conclusion:** The native API is an enhanced version of our spawn_workers_parallel +
delegate. It also solves the cold-start cache problem (Task #93 → solved for free).

## 2. Adaptation Approach — Hybrid (recommended)

Keep the existing system + add the native Agent tool. The sef auto-fills the SDK
options.agents dictionary from the registry. Both paths at once:
- **Native Agent tool**: one-off, parallel, zero cold start.
- **Old delegate/runSpecialist**: persistent specialists (multi-turn chat screen
  opened in the UI), Volpora etc.

### Phase 1 (LOW RISK — basic integration)

1. **Add registry specialists to the `main.ts` query options.agents:**
   ```ts
   const sdkAgents: Record<string, AgentDefinition> = {};
   for (const spec of registry.list()) {
     sdkAgents[spec.name] = {
       description: spec.uzmanlik,
       prompt: specialistSystemPrompt(spec.name, spec.role, ...),
       tools: spec.tools,
       model: spec.model.includes("[1m]")
         ? "claude-opus-4-8"        // model id [1m] stripped
         : spec.model,
       effort: spec.effort,
     };
   }
   // query options:
   agents: sdkAgents,
   allowedTools: [...existing, "Agent"],
   ```

2. **Add `Agent` to buildAllowedToolNames** (toolGroups.ts) — the sef always
   sees the Agent tool.

3. **Sef prompt update (prompts.ts CHIEF_PROMPT):**
   - "Use the Agent tool to ask a single specialist in parallel (shared context,
     no cold start)."
   - "Use delegate for a persistent multi-turn specialist (opens a chat screen)."

4. **parent_tool_use_id stream event handling:**
   - In the main.ts runChiefAttempt SDK stream event loop, if parent_tool_use_id
     exists, add it to the server.sendUzman* event. Subagent grouping in the UI panel.

### Phase 2 (MEDIUM RISK — efficiency)

5. **Deprecate spawn_workers_parallel**:
   - Note in the tool description "DEPRECATED — use the Agent tool (parallel + no
     cold start)".
   - Backend still works (for long-lived workers); but the sef's preference is Agent.

6. **delegate tool decision:**
   - If the task is one-off → route to the Agent tool (automatically or via a manual
     prompt).
   - Persistent multi-turn (UI chat) → the old delegate is kept.

### Phase 3 (HIGH RISK — full dynamic workflow support)

7. **Effort xhigh/max** (Task #99 integration):
   - Extend the registry.ts Effort type: `"low"|"medium"|"high"|"xhigh"|"max"`.
   - Add two new levels to the UI effort dropdown (router/helpers.ts EFFORTS).
   - New thresholds for xhigh/max in the effortLevel main.ts maxThinkingTokens map
     (xhigh~32k, max~64k thinking tokens — Anthropic standard).
   - When effort=xhigh is triggered, the sef automatically enters dynamic workflow
     mode — pass the `ultracode` setting flag to the SDK.

8. **background subagent:**
   - Integrate with bgTasks — AgentDefinition.background=true specialists are
     fire-and-forget. The sef tracks via parent_tool_use_id and an event is emitted
     when the result arrives.

9. **UI panel — subagent tree:**
   - We currently see the tool segment in ChatThread; for the Agent tool, group by
     subagent name + parent_tool_use_id. A hierarchical tree of hundreds of
     parallel subagents.

### Phase 4 (long term)

10. **Specialist subprocess elimination:**
    - If the cold-start cache problem is solved, persistent specialists can now be
      hosted via Anthropic Managed Agents or done entirely with SDK session-resume.
    - Hand runSpecialist + resilience.ts + healthMonitor over to Anthropic native
      lifecycle management.

## 3. Order of Work (#98 implementation)

Order for this task:

1. `orchestrator/sdkAgents.ts` (new) — registry → AgentDefinition map factory
2. `main.ts` query options.agents + allowedTools.Agent
3. `toolGroups.ts` Agent tool in the list
4. `prompts.ts` Agent tool description in CHIEF_PROMPT
5. `server.ts` parent_tool_use_id events
6. UI: parent_tool_use_id grouping in ChatThread (low-priority, skip in Phase 1)

Estimated 4-6 hours. The cold-start cache explosion in Task #93 is solved
automatically once native subagents land — a big win.

## 4. Risks

- **Cache invalidation**: the agents dict is sent every turn — if the specialist
  list changes within a sef session (add/remove) it is a cache miss. Solution:
  include the agents dict in the cache prefix; one cache_create on a runtime change
  is acceptable.
- **Identity drift**: native subagents come from AgentDefinition.prompt + the agents
  dict, must sync with the .md in the registry. The Fix 88 identity anchor must be
  applied to every specialist.
- **Tool restriction**: AgentDefinition.tools must be a subset (relative to the sef).
  Not a one-to-one parallel with spawn_workers_parallel — it is a direct SDK tool
  filter.
- **Exceeding maxTurns:** if a specialist stalls, a fail event goes to the parent.
  The existing HealthMonitor logic must be adapted.

## 5. Awaiting Approval

- If the hybrid approach (Phase 1 + 2 now, Phase 3 with #99, Phase 4 later) is
  approved, start implementation.
- In the fully-native option (drop the old specialist subprocesses) the user chat
  screen semantics change — how persistent specialists like Volpora are continued
  must be planned.

## 6. Sources

- [Introducing Dynamic Workflows in Claude Code](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code)
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- Local: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:38-92` (AgentDefinition), `1245-1261` (options.agents)
