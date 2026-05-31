# Pre-Compact Notes — 2026-05-28

This file is the continuity note for the conversation after compact. Created during the Mimar split work.

## STATUS

### Mimar split (in progress)
Plan: `docs/plan-buyuk-dosya-parcalama.md`
8 large files to be split (tools.ts → store → ChatThread → Notes → CodeGraph → ProjectScreen → +page → main.ts).
**DO NOT TOUCH** until Mimar finishes.

### Completed splits (observed):
- `ui/src/lib/store.svelte.ts` → SHIM (split into the store/ package)
- `ui/src/lib/ui/ChatThread.svelte` → helpers + chat/{AgentQuestionCard, ToolItem, CostLine} sub-components

### Ongoing split:
- The other files will be done by Mimar in order

## REBUILD STATUS

- Last rebuild failed (ui.exe was locked)
- Running binary = old (pre-Fix 106)
- The "[KOD ARAMA YASAK]" message still shows (the new "[KOD ARAMA YONLENDIRME]" is not active)
- Mimar will rebuild once the split is done

## OPEN TASK ORDER (after the split is done)

### High Priority — Model Update
1. **#97 — Claude Opus 4.8 integration (FIRST JOB)**
   - pricing.ts: OPUS_48_200K + OPUS_48_FAST constants
   - Model slug: `claude-opus-4-8-*` (verify against Anthropic docs)
   - Add to the UI model picker
   - Make Opus 4.8 the default chief model
   - Fast mode does not change quality (Anthropic official: "tokens arrive faster, not smarter")
   - Regular: $15/$75 (same as Opus 4.7)
   - Fast mode: 3x cheaper (~$5/$25), 2.5x faster
   - Benchmarks: agentic coding 69.2%, computer use 84%, multidisciplinary 57.9%

2. **#98 — Dynamic Workflow API adaptation**
   - Anthropic added a "dynamic workflow" to Claude Code (hundreds of parallel subagents native)
   - An enhanced form of our spawn_workers_parallel + delegate chain
   - Architect's core logic is now native in Anthropic — our main differentiator is at risk
   - Find the SDK API, adapt it into Architect

3. **#99 — Default model + effort settings per role**
   - Sef/Mimar/Advisor: Opus 4.8, **fast mode OFF**, effort **HIGH**
   - Specialist: Opus 4.8, **fast mode ON**, effort **MEDIUM**
   - UI effort dropdown: low/medium/high/**xhigh**/**max** (new levels)
   - Fast mode toggle as a live switch in the UI

### Medium Priority — System Analysis
4. **#95 — Root-cause experiment for fast context fill**
   - A `test-token-baseline` project from scratch + Opus[1m] sef
   - 25-turn standardized experiment (cold/warm/tool/long output/specialist/multi-turn)
   - Per-turn metrics: in/out/cacheRead/cacheCreate/cacheHitPct/totalContext
   - 10 possible causes verified one by one

5. **#93 — Specialist cold start cache_create cost**
   - 3 specialists delegated in parallel = 3x cold-start cache explosion
   - Solution options: warm pool / sessionId persistence / minimal prompt / shared prefix / tool minimize
   - Measure first, then strategy

### Low Priority — UI/UX Bugs
6. **#92 — Force CodeGraph usage**
   - After the Fix 106 deny softening, the sef does not use CodeGraph (falls back to Bash)
   - Solution options: PostToolUse nudge hook + prompt hardening
   - Behavior shaping without a deny

7. **#96 — Stop button bug**
   - When Stop is pressed the UI seems to stop, but 30s later the old turn continues
   - The next message in the queue gets skipped
   - `duraklat` vs `durdur` semantics may be confused

8. **#94 — Missing detailed specialist log**
   - Current: Mimar + sef + advisor fully logged (~27M)
   - The specialist's internal tool chain is missing
   - Solution: write the Fix 88 SpecialistEmitter events to the logger

### Awaiting Authorization
- **#74 DeepSeek** — multi-provider, requires Mimar authorization

## RECENT FIXES (committed, in code, rebuild needed)

- **Fix 104** `get_agent_chat` local specialist support (registry.get first)
- **Fix 105** Simplified cost display + proxy 5m default + cost UI breakdown tags
- **Fix 106** CodeGraph deny softening + watcher debounce 2000→500ms
- **Fix 107** Specialist HealthMonitor token-progress integration (false stuck timeout fix)
- **Fix 108** memory_remember project mix-up protection (auto-tag + cross-project warning)
- **Fix 109** Busy flag includes bgTasks + specialist health (rebuild guard works correctly)

## CLAUDE.md UPDATES

- FILE SIZE rule (the 1000+ line rule)
- Rebuild / Restart rule (Fix 109)

## prompts.ts UPDATES

- CHIEF_PROMPT: FILE SIZE rule (enforced on every specialist)
- GLOBAL_CHIEF_PROMPT: MANDATORY REBUILD/RESTART CHECK block + FILE SIZE
- AGENT CHAT HISTORY: local specialist support (with Fix 104)
- CODEGRAPH_HINT: Fix 106 softening notes

## IMPORTANT PERCEPTION NOTES

### Cache logic (reviewed, normal behavior)
- Every LLM call cacheCreate ~output_tokens (designed-in sliding window)
- Cumulative result.usage is the sum of 10-30 LLM calls (counted as a single "message")
- Explosion events (200k+ in a single call) = cache miss (5min TTL or session reset)
- Cache hit warm session 97-100% (the proxy uses 4 breakpoints)
- Verified from Mimar.log

### Fast context fill (not yet solved, experiment needed)
- Even Opus[1m] fills up fast
- The Fix 47/57 cumulative bug was fixed but the user still reported fast fill
- The 10 possible causes are eliminated by experiment (Task #95)

### Specialist cold start explosion
- N specialists delegated in parallel = N x cold start (~15-45k cache_create total)
- The foundation of the ecosystem, but the cost is unacceptable
- Solutions pending in Task #93

## FILE REFERENCE

- Plan file: `docs/plan-buyuk-dosya-parcalama.md`
- This note file: `docs/compact-notlar-2026-05-28.md`
- Mimar prompt: `orchestrator/prompts.ts:GLOBAL_CHIEF_PROMPT`
- Sef prompt: `orchestrator/prompts.ts:CHIEF_PROMPT`
- Specialist prompt: `orchestrator/prompts.ts:specialistSystemPrompt`
- Identity anchor: `orchestrator/main.ts:buildIdentityAnchor`
- canUseTool (Fix 106): `orchestrator/main.ts:1836-1900`
- Pricing: `orchestrator/pricing.ts`
- Proxy: `orchestrator/anthropicProxy.ts` (CACHE_CTRL ttl = "5m" default)
- Watcher debounce 500ms: `orchestrator/codegraph/watcher.ts`

## POST-COMPACT USER MESSAGE

The user will compact. After compact:
1. Read this file: `docs/compact-notlar-2026-05-28.md`
2. Wait until Mimar finishes the split
3. Let Mimar rebuild
4. Start with Task #97 (Opus 4.8)
