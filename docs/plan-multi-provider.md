# MULTI-MODEL PROVIDER ARCHITECTURE — IMPLEMENTATION PLAN

**Goal:** Free the system from being tied to a single LLM provider (Anthropic Claude) and move to a **provider-agnostic** architecture. Start: Claude + DeepSeek V4 Pro. Future: Gemini/GPT/Mistral plug-and-play.

**Approved Decisions (clarified by the user):**
- **Global switch**: the whole system (Mimar + all sefs + all specialists) on a single active provider
- **No switching during an active turn**: the UI selector is disabled while busy
- **Context transfer during a switch**: the active provider produces a compactSummary, a fresh session + summary is injected into the new provider; afterward all new messages go through the new provider
- **One-click UI selector**: model dropdown top-right
- **Failover thresholds**: to be decided by Mimar (below)
- **DeepSeek cache**: automatic server-side, we will not touch it; hit/miss ratio shown in the usage panel
- **Usage panel**: for now only locally-computed $/token + cache hit ratio; claude.ai console fetch is a later phase
- **DeepSeek V4 Pro documentation read**: model verified, price and API format confirmed
- **MCP integration**: keep the existing flow (automatic via claude-agent-sdk), with an adapter so it also works on DeepSeek
- **Vault key naming**: `provider.<name>.api_key` namespace
- **Per-phase commit + restart_self**: each phase a separate commit, move to the next phase after restart
- **Autonomy**: full — on blockers (no DeepSeek key / 5xx / etc.) try an alternative, do not ask the user

---

## 1. CRITICAL ARCHITECTURE DECISIONS (not put to user approval, given by Mimar's research)

### 1.1 DeepSeek has two endpoints — which one will we use?
DeepSeek offers both an OpenAI-compat (`https://api.deepseek.com`) and an **Anthropic-compat** (`https://api.deepseek.com/anthropic`) endpoint.

**Decision:** Use **OpenAI-compat**. Because:
- Anthropic-compat is a DeepSeek-specific convenience; Gemini/GPT/Mistral do not have it
- The ILLMProvider abstraction will already talk to each provider with its own native API
- If we tried Anthropic-compat, 100% support for tool_use/cache_control/thinking blocks is not guaranteed; there is risk
- OpenAI-compat = industry standard, a single base class (OpenAICompatProvider) is enough for future providers

### 1.2 How will the claude-agent-sdk subprocess be managed?
The current system uses `@anthropic-ai/claude-agent-sdk` to spawn a **subprocess** running the Claude CLI. This subprocess is routed to anthropicProxy via ANTHROPIC_BASE_URL.

**Decision:** The Anthropic provider implementation **uses the existing SDK as-is** (zero behavior change). The DeepSeek provider, without the SDK, makes HTTP calls directly with `fetch` (no subprocess). The two providers' execution models are fundamentally different — therefore the `ILLMProvider` interface defines ABSTRACT BEHAVIOR, not the ENGINE. Like so:

```ts
interface ILLMProvider {
  readonly id: "anthropic" | "deepseek" | string;
  readonly displayName: string;
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  // A single turn (shared by chiefs/specialists/workers):
  runTurn(opts: RunTurnOpts): AsyncIterable<ChunkEvent>;
  // Cost
  estimateCost(usage: NormalizedUsage, modelHint?: string): number;
  // Setup
  getRequiredCredentials(): CredentialSpec[];
  hasCredentials(): boolean;
  // Produce a compact summary (before a switch)
  compact(messages: NormalizedMessage[]): Promise<string>;
}
```

`RunTurnOpts`: systemPrompt, messages, tools, mcpServers, effort, maxTokens, modelHint, sessionRef.
`ChunkEvent`: `{ kind: "text"|"tool_call"|"tool_result"|"usage"|"done"|"error", payload }` — the event the UI and telemetry consume in a single format.

### 1.3 Tool adapter — Claude schema vs OpenAI function schema
Claude tool schema:
```json
{ "name": "...", "description": "...", "input_schema": { "type": "object", "properties": {...} } }
```
OpenAI/DeepSeek tool schema:
```json
{ "type": "function", "function": { "name": "...", "description": "...", "parameters": { "type": "object", ... } } }
```

**Decision:** `orchestrator/llm/adapter/tools.ts`:
- `toAnthropicTool(spec)`: NormalizedToolSpec → Claude format
- `toOpenAITool(spec)`: NormalizedToolSpec → OpenAI format
- The native Architect tools (55 of them) are already in Claude format in `tools.ts`; a separate `NormalizedToolSpec[]` list will be derived from them (single source of truth).
- MCP tool list: at provider start, discover from the MCP servers (the existing SDK does this), convert to NormalizedToolSpec, then give each provider its own format.

### 1.4 MCP integration on the DeepSeek side
The claude-agent-sdk handles MCP automatically (spawns the servers, extracts the tool list, routes when the model does tool_use, returns the result to the model — the whole loop inside the SDK).

On the DeepSeek (OpenAI-compat) side we will do it manually:
1. When Mimar starts, spawn the active MCP servers (reuse if they already exist in the sef system)
2. Pull the tool list from each server (`tools/list` MCP RPC)
3. Collect the tools as NormalizedToolSpec
4. Add to the `tools: [...]` array in the DeepSeek request
5. If the response returns with `tool_calls`: which tool belongs to which server? Find it from a lookup table, forward to the MCP server (`tools/call`)
6. Append the result as a `role: "tool"` message and continue the loop

**Decision:** `orchestrator/llm/adapter/mcp.ts` — McpRouter class. Provider-agnostic: usable by both Anthropic and DeepSeek BUT the SDK already handles it on Anthropic, so the router is active in DeepSeek mode. The MCP wrapper already working with the SDK (including codegraph) will be reused.

### 1.5 Streaming adapter
Anthropic SSE event types: `message_start`, `content_block_start`, `content_block_delta` (text_delta / input_json_delta), `content_block_stop`, `message_delta` (usage), `message_stop`.
OpenAI SSE: `data: {...}\n\n` (delta.content / delta.tool_calls), final `data: [DONE]`.

**Decision:** `orchestrator/llm/adapter/streaming.ts`:
- `parseAnthropicStream(sse): AsyncIterable<ChunkEvent>`
- `parseOpenAIStream(sse): AsyncIterable<ChunkEvent>` (including DeepSeek)
- ChunkEvent is a single type — runChiefAttempt only reads this, regardless of which provider.

### 1.6 Provider field in SessionStore
The current `SessionState` holds model + effort. What we will add:
```ts
provider?: string | null;          // "anthropic" | "deepseek" | ...
providerSessionId?: string | null; // Anthropic: claude session resume id; DeepSeek: null
normalizedMessages?: NormalizedMessage[]; // filled only in DeepSeek mode — manual message history
```

**Decision:** In Anthropic mode the existing session resume mechanism works as-is. In DeepSeek mode all history is kept in the `normalizedMessages` array (added to the request body every turn). On a switch, a compactSummary is produced and becomes the new provider's first message; the old normalizedMessages are cleared.

### 1.7 Failover thresholds (Mimar decision — question E)
- **5xx**: 3 consecutive 5xx (within a 1-min window) → swing
- **Timeout**: 60s (request abort) — 2 consecutive → swing
- **Auth fail (401/403)**: swing immediately + UI banner "credentials invalid"
- **Rate limit (429)**: 30s backoff then 1 retry, still 429 → swing
- **Failback**: health check runs every 30s. If the preferred (manually selected) provider shows 5 consecutive healthy (200 OK) → auto-return.
- **No swing to a no-credential provider** (phase 4)
- **No mid-tool-call swing** — the decision is made after the last tool_result is received

### 1.8 V4 Pro vs V4 Flash
DeepSeek V4 Pro: $0.435/M in_miss, $0.87/M out, 1M ctx, concurrency 500
DeepSeek V4 Flash: $0.14/M in_miss, $0.28/M out, 1M ctx, concurrency 2500

**Decision:** Start with **V4 Pro as the only model** (matches the user request). Optional in Phase 5: segregate Flash for specialists, Pro for chiefs. Config flag: `DEEPSEEK_TIER_SPLIT: boolean`.

### 1.9 Vault key naming
- `provider.deepseek.api_key`
- `provider.anthropic.oauth_refresh_token` (already managed by claude-agent-sdk, can be moved here in the future)
- `provider.gemini.api_key` (future)
- `provider.openai.api_key` (future)

### 1.10 Per-provider pricing
`orchestrator/llm/pricing.ts` (new — `orchestrator/pricing.ts` stays as-is, the new file is a provider-aware wrapper):
```ts
function priceModel(provider: string, model: string, opts): ModelPrice
function estimateNormalizedCost(provider: string, usage: NormalizedUsage, model: string): number
```
NormalizedUsage: `{ uncachedInput, cacheRead, cacheCreate1h, cacheCreate5m, output }` — on DeepSeek the cacheCreate* fields are 0 (server-side automatic), uncachedInput = `prompt_cache_miss_tokens`, cacheRead = `prompt_cache_hit_tokens`.

### 1.11 Compact production
Who produces the compactSummary during a switch?

**Decision:** The **active (outgoing) provider** produces it. Because:
- The active provider already knows the conversation, the most faithful summary
- The switch is fast since no extra call is made to the new provider beforehand
- If the old provider is unreachable (failover scenario) → fallback: use the existing sessionStore.compactSummary value (left over from the daily compact)

### 1.12 UI selector busy behavior
- If there is an active turn (queue.runningCommand !== null) the selector is disabled + tooltip "Let the active task finish"
- When a switch is clicked: a `switchProvider(targetId)` action to the server, success → toast + UI state updated
- If the target provider has no credentials → ProviderSetupModal opens, the user enters a key → write to the vault → retry the switch

---

## 2. FILE STRUCTURE (new additions)

```
orchestrator/
  llm/
    index.ts            # public API: activeProvider, switchProvider, runTurn etc.
    types.ts            # ILLMProvider, ChunkEvent, NormalizedMessage, ToolSpec, Usage
    registry.ts         # provider registry, active state, switch logic
    failover.ts         # health check + auto-switch + failback
    pricing.ts          # provider-aware price lookup
    session.ts          # NormalizedSession (provider-agnostic message history)
    providers/
      anthropic.ts      # existing claude-agent-sdk wrapper (ILLMProvider impl)
      deepseek.ts       # DeepSeek V4 Pro impl (OpenAI-compat fetch)
      openai-compat.ts  # base class — for future providers (Gemini, GPT)
    adapter/
      tools.ts          # NormalizedToolSpec ↔ Claude / OpenAI format
      streaming.ts      # SSE parse → ChunkEvent
      mcp.ts            # McpRouter (manual MCP loop in DeepSeek mode)
ui/
  src/lib/
    ui/
      ModelSelector.svelte       # top-right dropdown + status indicator
      ProviderSetupModal.svelte  # API key entry / OAuth screen
      FailoverBanner.svelte      # "Failover active: DeepSeek" banner
    UsagePanel.svelte            # EXISTING Usage.svelte refactor — tabbed
    store.svelte.ts              # +activeProvider, +providerStatus, +failoverState
```

---

## 3. PHASE-BY-PHASE IMPLEMENTATION PLAN

At the end of each phase:
- `npm run typecheck` clean
- Manual test (specified within the phase)
- Conventional commit (feat/refactor/...)
- A new Mimar continues to the next phase via `restart_self` (per user preference: the first — test live in each phase)

### PHASE 1 — ABSTRACTION LAYER (refactor only, behavior unchanged)

**Goal:** Wrap the existing `claude-agent-sdk` calls with `llm.activeProvider.runTurn(...)`. The system should keep working exactly as it looks from the outside.

**Steps:**
1. `orchestrator/llm/types.ts` — interface + type definitions
2. `orchestrator/llm/registry.ts` — provider registry, `setActive`, `getActive`, default = anthropic
3. `orchestrator/llm/providers/anthropic.ts` — wrap the existing SDK calls in `runTurn()`
4. `orchestrator/llm/adapter/streaming.ts` — Anthropic SDK message stream → ChunkEvent
5. `orchestrator/llm/session.ts` — NormalizedSession (shim for anthropic, store the SDK session resume id)
6. `orchestrator/llm/pricing.ts` — existing pricing wrapper (anthropic profile only)
7. `orchestrator/main.ts` runChiefAttempt: replace the `query({...})` call with `llm.runTurn({...})`; iterator + cost flow the same
8. `orchestrator/specialist.ts` + `worker.ts` same refactor

**Output:** typecheck OK, all existing features (chief, specialist, worker, MCP, hooks, cache, telemetry) error-free. No behavior difference.

**Commit:** `refactor(llm): introduce provider-agnostic ILLMProvider abstraction (anthropic only)`

**Test:** Send a message, a normal turn runs; no difference in the UI. Usage calculations the same numbers.

---

### PHASE 2 — DEEPSEEK PROVIDER

**Goal:** When `llm.setActive("deepseek")` runs, the whole system flows through DeepSeek V4 Pro.

**Steps:**
1. `orchestrator/llm/providers/openai-compat.ts` — base class (fetch + SSE parse + tool loop)
2. `orchestrator/llm/providers/deepseek.ts` — extends openai-compat, model id, pricing, thinking mode
3. `orchestrator/llm/adapter/tools.ts` — NormalizedToolSpec + two-way converter; normalize 55 native tools + the MCP tool list
4. `orchestrator/llm/adapter/mcp.ts` — McpRouter: server discovery, tool list, tool_call → MCP forward → result
5. `orchestrator/llm/adapter/streaming.ts` — OpenAI SSE parser
6. `orchestrator/llm/session.ts` — NormalizedSession.messages filled (appended each turn)
7. `orchestrator/llm/pricing.ts` — DeepSeek V4 Pro / Flash price profile added
8. add/get/test function using `orchestrator/vault.ts` for `provider.deepseek.api_key`
9. `orchestrator/llm/registry.ts` — register the DeepSeek provider

**Output:** typecheck OK. Manual test: write a deepseek api key to the vault, call `llm.setActive("deepseek")`, send a message — a response should come from DeepSeek, MCP tools (including codegraph) should work, telemetry should compute with DeepSeek pricing.

**Commit:** `feat(llm): add DeepSeek V4 Pro provider with OpenAI-compat client, tool/MCP/streaming adapters`

**Test (mimar manual):**
- setActive("deepseek") with no key in vault → "hasCredentials false" error
- After entering the key, setActive("deepseek") → success
- Send a message → a DeepSeek response comes
- A message using a tool (code_search etc.) → works
- A message using an MCP tool (codegraph mcpTools) → works
- The Usage panel computes DeepSeek $

---

### PHASE 3 — UI MODEL SELECTOR + SETUP MODAL

**Goal:** Top-right dropdown, active model display, click → switch, setup modal if no credentials.

**Steps:**
1. Add `activeProvider`, `providerStatus[]` to the `orchestrator/main.ts` getStatus payload
2. Add `switchProvider(providerId)`, `setProviderCredential(providerId, key, value)` to the `orchestrator/server.ts` control actions
3. `ui/src/lib/store.svelte.ts` — `activeProvider`, `providers[]` (id, displayName, status, hasCredentials) state
4. `ui/src/lib/ui/ModelSelector.svelte` — dropdown component (top-right, placed in the App.svelte top-bar)
5. `ui/src/lib/ui/ProviderSetupModal.svelte` — DeepSeek: API key input + "Connect and Test" button
6. Disable logic: selector disabled while the queue is busy, tooltip
7. Toast: switch success → "DeepSeek active", failure → error message

**Output:** A real model-switch experience works in the UI.

**Commit:** `feat(ui): add ModelSelector + ProviderSetupModal for provider switching`

**Test:** Open the top-right dropdown, select deepseek → setup modal (if no key), enter key, connect, send a message → DeepSeek active. Switch back to claude → claude active.

---

### PHASE 4 — AUTO-FAILOVER

**Goal:** When the active provider becomes unreachable, automatically swing to the other healthy one, show a banner, return when health recovers.

**Steps:**
1. `orchestrator/llm/failover.ts` — HealthMonitor class (ping the active provider every 30s; consecutive fail counter)
2. Apply the thresholds (the numbers in 1.7)
3. Mid-tool-call protection: learn the active turn state from the queue, make the swing decision after the last tool_result event
4. Swing operation: active provider produces compact → switch → toast/banner
5. Failback: ping the preferred provider every 30s → 5 consecutive OK → return + toast
6. UI: `FailoverBanner.svelte` — shown while store.failoverActive is true
7. Add `failoverState: { active, originalProvider, currentProvider, reason, since }` to getStatus

**Output:** Anthropic 5xx simulation (test by breaking the key) → DeepSeek active within 30s, banner shown. Fix the key → returns to Claude after 5 health checks.

**Commit:** `feat(llm): auto-failover with health checks and graceful provider switching`

---

### PHASE 5 — MODEL ASSIGNMENT RULES

**Goal:** On a provider switch, the model fields in the agent definitions are set automatically and correctly.

**Steps:**
1. `orchestrator/llm/registry.ts` — `getDefaultModelFor(role)`:
   - anthropic + role="chief"|"advisor" → `claude-opus-4-7-[1m]`
   - anthropic + role="specialist" → `claude-sonnet-4-6`
   - deepseek + any role → `deepseek-v4-pro`
2. `orchestrator/registry.ts` (agent registry) regenerates the model field of all agents on a provider switch event
3. Persistence: a per-session custom model preference is preserved (if sessionState.model is set, it overrides)
4. Config flag (future): `DEEPSEEK_TIER_SPLIT` — if true, specialists Flash, chiefs Pro

**Output:** In Claude mode Mimar opus, specialists sonnet; in DeepSeek mode all V4 Pro. The model name in the UI agent card indicator is correct.

**Commit:** `feat(llm): provider-aware model assignment for chiefs/advisors/specialists`

---

### PHASE 6 — TABBED USAGE PANEL

**Goal:** `Usage.svelte` (or a new `UsagePanel.svelte`) becomes tabbed: Claude / DeepSeek / Total.

**Steps:**
1. `orchestrator/usage.ts` — add a `provider: string` field to UsageEntry (backward compat: undefined → "anthropic")
2. Mark the active provider on UsageTracker `recordTurn` calls
3. Aggregation: per-provider total $/token/turn
4. `ui/src/lib/Usage.svelte` refactor:
   - Tabs: All / Claude / DeepSeek
   - Per tab: 24h / 7d / monthly $, usage by model, cache hit ratio, current session
5. DeepSeek tab: concurrency usage (current active request count) + V4 Pro/Flash split
6. Claude tab: opus/sonnet/haiku split, 1m vs 200k cache cost

**Output:** A tabbed usage panel in the Reports menu, each provider's cost shown separately.

**Commit:** `feat(reports): provider-tabbed usage panel with per-model breakdown`

---

### PHASE 7 — TEST + DOC + FINAL

**Goal:** End-to-end test of the whole system, documentation, final commit + restart.

**Steps:**
1. Manual test scenarios:
   - Phase 1: anthropic-only message flow (no regression)
   - Phase 2: deepseek message + tool + MCP
   - Phase 3: UI switch + setup modal
   - Phase 4: 5xx simulation, failover + failback
   - Phase 5: agent model indicators correct
   - Phase 6: usage panel tabbed, numbers correct
2. `typecheck` + `rebuild_ui`
3. Mark `docs/plan-multi-provider.md` -> COMPLETED, add a short summary
4. Final commit: `chore: multi-provider architecture complete (claude + deepseek + failover + ui)`
5. `restart_self(devam_gorevi="multi-provider is live, claude+deepseek tested, report")`

---

## 4. DELEGATION PLAN (specialist assignment)

This work is complex enough that Mimar **can do it alone**, but it is large. The process is long, so to keep attention from drifting, specialized workers may be preferred. Decision:

- **Phase 1 (refactor)**: Mimar does it **himself** — runChiefAttempt is very complex, risky for an external specialist
- **Phase 2 (DeepSeek provider)**: Mimar does it **himself** — critical core
- **Phase 3 (UI selector + modal)**: a new specialist can be created and delegated (`ui-llm-provider`)
- **Phase 4 (failover)**: Mimar himself — system-wide
- **Phase 5 (model assignments)**: Mimar himself — small
- **Phase 6 (UsagePanel)**: can be delegated to a UI specialist
- **Phase 7 (test+doc)**: Mimar himself

**General principle:** core/LLM logic in Mimar's hands, delegate the UI side to a specialist (Phases 3 and 6).

---

## 5. RISKS + MITIGATION

| Risk | Mitigation |
|------|------------|
| claude-agent-sdk subprocess behavior is unpredictable | Very detailed regression test at the end of Phase 1, rollback on error |
| DeepSeek tool format differences (strict mode) | Use the normal (non-beta) OpenAI-compat endpoint, no strict |
| Manual management of the MCP server on the DeepSeek side is fragile | In Phase 2 test first with simple MCP servers (codegraph), then windows-mcp/n8n |
| Compact production stalls mid-switch | Try/catch + fallback: use the existing sessionState.compactSummary |
| Failover loop (claude fail → deepseek fail → claude fail) | Circuit breaker in failover: if 2 swings within 3 minutes, "manual intervention" toast |
| Wrong pricing calculation | Debug log on NormalizedUsage, hand-check usage.json the first week |
| UI session continuity breaks | `provider` field per-turn in sessionStore, old messages read with the old provider's metadata |

---

## 6. SELF-TELEMETRY (so far)

- **Tool call count (before the plan):** 12 (code_stats, code_search x6, glob x2, read x4, webfetch x3, bash x1)
- **Estimated tokens (input + output):** ~25k in, ~5k out
- **Estimated cost:** ~$0.40 (outside the opus 1m tier, normal usage)
- **Decision clarity:** questions were not re-asked; answers were obtained directly via research + file structure scan + document fetch

**Per-phase reporting:** right after each phase commit, a short note "phase complete, cost: $X, tools: Y, note: Z" will be sent to the user.

---

## 7. SUCCESS CRITERIA (final acceptance)

1. ✅ Top-right selector: click to switch between claude / deepseek
2. ✅ If no credentials, the setup modal opens, connects once the key is entered
3. ✅ After a switch the existing chat is transferred to the new provider via compact
4. ✅ Automatic failover within 30-60s on 5xx/timeout/auth fail simulation
5. ✅ Tabbed usage in the Reports menu (Claude / DeepSeek / All)
6. ✅ All existing features (MCP, codegraph, advisor, specialist, queue, audit, memory) intact
7. ✅ Claude mode: chiefs opus[1m], specialists sonnet. DeepSeek mode: all V4 Pro.
8. ✅ Adding a new provider = `providers/new.ts` + a register call; 0 changes in other files
