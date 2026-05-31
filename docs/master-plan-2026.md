# Architect Master Plan — 2026 Q2-Q3

Decision: Option B + target ecosystem (per-role skills + autonomous 3-day + cost control).

User approval: 2026-05-28. The direct specialist chat UX is unused — to be removed. Goal: layered mimar/sef/advisor, autonomous and long-lived, minimum cost.

---

## 1. Overall Goals

| # | Goal | Measure |
|---|-------|--------|
| H1 | Per-role skill loading for mimar/advisor/sef | skill dropdown + loading work in the UI |
| H2 | Live Mimar↔Sef↔Advisor interaction | talk_to_chief + message_agent preserved |
| H3 | Autonomous 3+ day operation | when the sef is told "do 3 days of work" it finishes even with no user |
| H4 | Min cost | per-specialist cap + auto fast fallback + cache 95%+ |
| H5 | Specialists are invisible internal tools | remove the UI specialist chat screen, native Agent only |

---

## 2. Phase Order + Estimate

| Phase | Task | Duration | Dependency |
|-----|------|------|-----------|
| **F1** | Option B — remove specialist subprocess + UI specialist chat | 3-5 days | none |
| **F2** | #100 Skill system per-role | 2-3 days | F1 |
| **F3** | #101 Autonomous 3-day mode | 2-3 days | F1 |
| **F4** | #102 Cost control + auto fast fallback | 1-2 days | F2 (since the skill is model-bound) |
| **F5** | #87 Sef project mix-up bug | 0.5-1 day | none |
| **F6** | #92 Force CodeGraph usage (without a Bash deny) | 1-2 days | none |
| **F7** | #96 Stop button bug (duraklat/durdur semantics) | 1-2 days | none |
| **F8** | #85 Investigate specialist error_during_execution | 0.5-1 day | after F1 (specialist logic changes) |
| **F9** | #90 Further split of main.ts (runChiefAttempt etc.) | 1-2 days | F1 (main is cleaner once 1500 lines are deleted) |
| **F10** | #95 Root-cause experiment for fast context fill | 1-2 days | after F1 (new baseline) |
| **F11** | #74 DeepSeek multi-provider | 5-7 days | requires Mimar authorization, independent |
| **F12** | #52 Fix 68 Token bloat test (if still meaningful) | 1 day | after F10 |

**Total:** 19-32 days of work. Realistically 4-6 weeks.

---

## 3. Phase Details

### F1: Option B (3-5 days)

#### Backend Deleted
- `orchestrator/specialist.ts` (~600 lines): runSpecialist + SpecialistEmitter + EFFORT_THINKING + identity anchor
- `orchestrator/resilience.ts` (~300 lines): runSpecialistResilient retry/transient/timeout
- `orchestrator/health.ts` (Fix 107 lastTouch logic, ~100 lines partial)
- `orchestrator/tools/delegateTools.ts` (~250 lines): the delegate tool is removed (Agent is enough)
- `orchestrator/server.ts` (~100 lines): sendUzman* events are removed
- `orchestrator/main.ts` (~150 lines): cleanup of buildSpecialistEmitter + onSpecialistMessage + places using chiefTools.delegate

#### Backend New
- `orchestrator/subagentEvents.ts` (~80 lines): stream parent_tool_use_id events from the SDK to server.ts
- `orchestrator/tools/agentTools.ts` updated (~80 lines): create_agent into the registry + runtime SDK options.agents reload (new session instead of a query restart)

#### UI Deleted
- `ui/src/lib/ProjectScreen.svelte` (~300 lines): selectedAgent + agentChat + specialistLive block, "switch to specialist mode" logic
- `ui/src/lib/project/AgentCard.svelte` (~50 lines): onSelect removed (it is the sef's tool, the user does not click)
- `ui/src/lib/store/specialistLive.ts` (~80 lines): emptySpecialistLive + Fix 88 state deleted
- `ui/src/lib/store/projectSession.svelte.ts` (~150 lines): sendToAgent/specialistChats methods
- `ui/src/lib/ui/ChatThread.svelte` (~50 lines): specialist mode

#### UI New
- `ui/src/lib/project/SubagentInline.svelte` (~200 lines): the Agent tool segment in the sef chat — grouped by parent_tool_use_id, a card like "Volpora-frontend specialist worked 12s, used 3 tools, result: X"
- `ui/src/lib/project/AgentRoster.svelte` (~150 lines): left panel — LISTS the specialists (read-only), click → last N task history

#### Behavior Change
- The sef calls a specialist via the Agent tool (the Phase 1 prompt already does this)
- The specialist has no "session" state — each call is an independent isolated context
- Specialist history: stored in registry.chat[] (registry.ts is kept)

#### Test
- "Open the Volpora project, write to the sef 'create a frontend specialist + create button.tsx'" → the Agent tool creates the specialist and spawns
- End of spawn bugs as a result of removing the cross-platform Windows + Linux subprocess
- Measure RAM: before/after with 10 specialists

---

### F2: Skill System (#100, 2-3 days)

#### Anthropic SDK Skills Structure
Two methods in the SDK:
1. `AgentDefinition.skills?: string[]` — pre-loads agent-level skills
2. `.claude/skills/<skill>/SKILL.md` file-based — activated via settingSources options

#### Architect Skill Layout
```
~/.architect/skills/
  mimar/
    typescript-master/
      SKILL.md           # system prompt augmentation
      examples/
    refactor-guru/
      SKILL.md
  advisor-seo/
    keyword-research/
    google-algorithms/
  sef-volpora/
    laravel-backend/
    nextjs-ssr/
  global/                # shared by all sefs
    git-workflow/
    test-driven/
```

#### Backend
- `orchestrator/skills.ts` (new ~200 lines): directory scan + load + inject into the AgentDefinition.skills field
- `orchestrator/registry.ts`: the SpecialistDef.skills field already exists
- `orchestrator/main.ts` query options:
  - for mimar/sef: `settingSources` with `~/.architect/skills/{role}/`
  - for the subagent: the AgentDefinition.skills array
- `orchestrator/tools/agentTools.ts`: new `attach_skill` / `detach_skill` / `list_skills` tools
- `orchestrator/tools/chiefComm.ts`: add `skills: [...]` to the list_advisors response

#### UI
- `ui/src/lib/skills/SkillManager.svelte` (new ~300 lines): role selector + skill list + load/remove
- "Skills" tab in the Mimar panel + Advisor panel + Sef panel
- `ui/src/lib/api.ts`: listSkills, attachSkill, detachSkill, createSkill API

#### UX
- The user clicks the "Skills" tab in the Volpora sef panel
- The currently loaded skills are listed (laravel-backend, nextjs-ssr)
- "New Skill" button → choose a marketplace or local directory
- When a skill is loaded it is added to the sef's system prompt; cache invalidate once

#### Cost Impact
- A skill = extra system prompt (cache prefix). 1-3k tokens per skill.
- One cache_create on load. Cache hit every turn afterward.
- 5 skills = ~10-15k system prompt increase (one-time cache cost).

---

### F3: Autonomous 3-Day Mode (#101, 2-3 days)

#### Existing Infrastructure
- `bgTasks` (backgroundTasks.ts) already exists
- `autonomous turn` (continue after main.ts runChiefAttempt) already exists
- `maybeAutoCompact` (190k/900k threshold) already exists
- `HealthMonitor` stuck guard (Fix 107 lastTouch) already exists

#### Missing / New
- `orchestrator/autonomousMode.ts` (new ~250 lines):
  - `startLongRunningJob(sef, taskDescription, maxDays)`: put the sef into autonomous mode, periodic checkpoint
  - Auto-commit every 30 min or on 5+ file changes
  - On error, rollback to the last safe commit (auto-rollback)
  - Reflect a progress event to the UI every 1 hour
  - Final report: file/commit/test/cost summary
- `orchestrator/notifications.ts` (new ~150 lines):
  - Email (SMTP via node-mailer or Anthropic API integration)
  - Webhook (Slack/Discord/Telegram via HTTP)
  - OS notification (Tauri already has it)
- These are enable/disable in user settings

#### UI
- `ui/src/lib/autonomous/JobMonitor.svelte` (new ~200 lines): active autonomous-job panel — day timeline + per-hour progress + cost + commit log + live activity
- "Autonomous Job" tab in the ProjectScreen right panel

#### New Tools
- `start_autonomous_job(task, maxDays, notifyOnComplete?)`
- `pause_autonomous_job(jobId)`
- `resume_autonomous_job(jobId)`
- `cancel_autonomous_job(jobId)`

#### Flow
1. User: "Rewrite the checkout page from scratch in the Volpora project. I'll be away 3 days."
2. Sef: `start_autonomous_job("checkout refactor", 3)` — a bgTask is created, the sef goes autonomous
3. Sef plans + parallel Agent calls + git_commit every 30 min
4. On error: rollback to last commit + retry
5. If context hits 900k: auto-compact + continue
6. When all tasks are done: notify (email + UI) + final report
7. The user returns: "47 commits, 23 files, 12 hours of work, $24.50 spent"

---

### F4: Cost Control (#102, 1-2 days)

#### Backend
- `orchestrator/budgetManager.ts` (new ~200 lines):
  - Per-specialist daily cap (default $5)
  - Per-sef daily cap (default $20)
  - Per-mimar daily cap (default $50)
  - Hourly burn rate alarm (>$X/h warning)
  - Auto-fallback: at 80% of cap, a specialist drops to fast mode (Opus 4.8-fast)
  - Cost prediction: token estimate at the start of a turn + USD equivalent
- `orchestrator/pricing.ts`: integrated with budget calculations (existing)
- `orchestrator/usage.ts`: dailyUsd/hourlyUsd tracking per-agent

#### UI
- `ui/src/lib/budget/BudgetCard.svelte` (new ~150 lines): live budget gauge + remaining + cap edit
- A "Budget" gauge in the ChiefToolbar (contextGauge already exists, similar)
- Cap setting on each Mimar/Sef/Advisor profile page

#### Behavior
- At the start of a turn the sef: "This job is ~$3.50. Spent today $8 / $20 cap. Continue?" (prompt + ask_user_choice)
- When the cap is exceeded: error + UI alarm + auto-pause or just a warning (user choice)
- Daily report: most expensive turn/specialist + average turn cost

---

### F5: #87 Sef Project Mix-up (0.5-1 day)

The Fix 108 memory_remember protection exists, but a prompt-level mix-up remains. The sef may mention google_yorum code while working on Volpora.

#### Solution
- `orchestrator/prompts.ts` `buildProjectContext()`: write the project separator more aggressively
- `orchestrator/main.ts` query options.cwd is already projectRoot — verify
- Prefix the cross-agent talk_to_chief response with the real project name
- If it really mixes things up: find evidence via log search, add a specific reminder to the sef

#### Test
- Ask the Volpora sef "what are we doing in this project"
- Ask the Google_yorum sef the same question
- If no mix-up: fine. If there is: harden the prompt.

---

### F6: #92 Force CodeGraph (1-2 days)

After Fix 106 softened the Bash deny → the sef does not use CodeGraph, falls back to Bash.

#### Solution
- Add an aggressive "PREFER CodeGraph" block to CHIEF_PROMPT in `orchestrator/prompts.ts`
- PostToolUse hook (`orchestrator/sdkHooks.ts`):
  - When a Bash grep + Symbol pattern is detected, nudge the sef: "This is faster with CodeGraph code_search"
  - No blocking, only guidance
- CodeGraph usage metric: per-turn CodeGraph % vs Bash search %
- Badge in the UI: "This sef's CodeGraph usage rate is X%"

---

### F7: #96 Stop Button Bug (1-2 days)

Current: when Stop is pressed the old job does not stop, and it does not move to the one waiting in the queue. duraklat/durdur semantics are confused.

#### Solution
- `orchestrator/main.ts` durdur flow:
  - Durdur = abort the current turn + wait for the next queued message
  - Duraklat = abort the current turn + DO NOT FILL the queue
  - The difference must be shown clearly in the UI
- `ui/src/lib/ui/Composer.svelte` onStop callback: durdur-type parameter
- `ui/src/lib/store/projectSession.svelte.ts`: separate control("durdur") + control("duraklat")
- Test:
  - When Stop is pressed, does the next queued message start within 2s?
  - After resume from pause? Is the message waiting?

---

### F8: #85 specialist error_during_execution (0.5-1 day, after F1)

With F1 the specialist subprocess goes away, so this error geometrically disappears too (native Agent has a different error path). If a similar error appears with the native Agent:
- Inspect the SDK Agent tool error capture mechanism
- Analyze the tool_use stop_reason in the parent_tool_use_id event

---

### F9: #90 Further main.ts Split (1-2 days, after F1)

With F1 ~150 lines are deleted, leaving main.ts ~3180 lines. Move the following parts to separate modules:

- `runChiefAttempt` (~1100 lines) → `orchestrator/chief/runChiefAttempt.ts`
- `runCommand` (~250 lines) → `orchestrator/chief/runCommand.ts`
- `runCompact` + `maybeAutoCompact` (~300 lines) → `orchestrator/chief/autoCompact.ts`
- `queueRunner` (~200 lines) → `orchestrator/queueRunner.ts`
- `statusBuilder` (~150 lines) → `orchestrator/statusBuilder.ts`

State (chiefModel/chiefEffort/sessionUsd/hourlyUsdBuckets/lastContext) → `orchestrator/state.ts`

Remaining main.ts: bootstrap + DI + signal handlers (~200 lines).

---

### F10: #95 Fast Context Fill Experiment (1-2 days, after F1)

Clean measurement with the new baseline after F1:
- A `test-token-baseline` project from scratch
- Opus[1m] sef
- 25-turn standard experiment:
  - 5 turns cold start (cold cache)
  - 5 turns tool usage
  - 5 turns long output
  - 5 turns multi-turn reference
  - 5 turns Agent tool subagent
- Per-turn metric: in/out/cacheRead/cacheCreate/cacheHitPct/totalContext
- Verify the 10 possible causes one by one:
  1. cumulative usage bug (Fix 57 fix)
  2. system prompt bloat (mem/compact)
  3. tool schema every turn (Fix 7 fix)
  4. cache invalidation pattern
  5. cache breakpoint (4 limit)
  6. parent context bloat (history slice)
  7. registry agents dict cache prefix effect (new!)
  8. CodeGraph results landing on the sef
  9. notify/memory bloat
  10. baseChiefPrompt bloat

#### Output
- `docs/context-bloat-analiz-2026.md` final report
- A list of action items

---

### F11: #74 DeepSeek Multi-Provider (5-7 days, parallel work is fine)

#### Backend
- `orchestrator/providers/` (new directory):
  - `anthropic.ts` (wrap the existing SDK)
  - `deepseek.ts` (new)
  - `interface.ts` (provider abstract)
- `orchestrator/runtime.ts`: provider selection
- `orchestrator/pricing.ts`: add the DeepSeek price table
- Model name prefix: `deepseek:chat`, `deepseek:reasoner` etc.

#### UI
- Add DeepSeek options to the ChiefToolbar model picker
- A DeepSeek field in the API key UI

#### Complexity
- DeepSeek tool calling differs from Anthropic
- Stream format differs
- No cache mechanism (need to measure whether it lowers productivity)
- The provider abstraction layer matters — the "model.startsWith('claude')" check must be removed everywhere

---

### F12: #52 Fix 68 Token Bloat Test (1 day, after F10)

If the #95 experiment covers this test: deleted.
If a separate scenario test is needed: run short A-G explicit tests and report.

---

## 4. Wait + Dependencies Diagram

```
F1 (B)
 ├──→ F2 (Skill)        ──→ F4 (Cost)
 ├──→ F3 (Autonomous)   ──→ F4
 ├──→ F8 (error fix — if any)
 ├──→ F9 (main split)
 ├──→ F10 (context experiment)──→ F12 (token bloat test)
 │
F5 (project mix-up)     — independent
F6 (force CodeGraph)    — independent
F7 (stop bug)           — independent
F11 (DeepSeek)          — independent, Mimar authorization
```

---

## 5. Risk Management

| Risk | Phase | Mitigation |
|------|-----|-------|
| Hidden use of the F1 specialist tool chain | F1 | First list all delegate calls via log search, route them all to Agent in the sef prompt |
| Skill system cache-invalidate bloat | F2 | Skill loading = explicit user action (not every turn); one cache_create accepted |
| Autonomous mode infinite loop | F3 | Max day cap (default 7) + max cost cap + abort signal |
| DeepSeek provider abstraction leakage | F11 | Strict adapter pattern — provider.is_anthropic() instead of a model.startsWith check |
| Context experiment baseline drift | F10 | Wait 1 week after F1 (until the system settles) |
| F4 budget cap is gamed | F4 | HARD abort when the cap is exceeded, manual override required |

---

## 6. Measurement & Success Criteria

| Goal | Measure | Success |
|-------|-------|--------|
| H1 Skill | skill loading in the UI + Mimar/Sef behavior change | 3+ skill packages work |
| H2 Interaction | talk_to_chief + Agent + message_agent test | Cross-agent test pass |
| H3 Autonomous | when told "do X for 3 days" it finishes while the user is away | Get the commits + final report when a Volpora feature is done |
| H4 Cost | Daily cost report + cap honor | All sefs under $20/day |
| H5 Specialist invisible | no specialist chat screen in the UI | After F1 no screen, Agent inline in the sef chat |

---

## 6.5. IMPLEMENTATION STATUS (2026-05-29 — completed)

All phases + extra fixes implemented, tested, committed. Summary:

| Phase/Fix | Commit | Status |
|---------|--------|-------|
| F1.1-1.4 Option B | a3e9a54..d3fe596 | DONE — specialist subprocess deleted, SubagentInline card |
| Fix 104 model slug | 7c57e83 | DONE — live Mimar test 6s ✓ |
| Fix 105 user_choice duplicate | 7c57e83 | DONE |
| F5+F6 project boundary/CodeGraph | 59834b8 | DONE |
| F2 skill system | 8901f10 | DONE (backend+tool; UI manager awaits Rust handler) |
| F3 autonomous mode | 30ed094 | DONE + JobMonitor mount (b4a26de) |
| F7 durdur/duraklat | a9e1ec6 | DONE |
| F4 budget manager | 399b7eb | DONE + ChiefToolbar pill |
| F9 main.ts split | 1d54c4e | DONE 3478→988 lines |
| Fix 106 chat freeze | 8a8256d | DONE PAGE 30 + autoGrow rAF |
| Fix 107 memory cross-project | 8a8256d | DONE project tag isolation |
| Test suite | 8c396a5 | DONE 86 assertions / 8 suites ✓ |

**Remaining (deferred):**
- F11 #74 DeepSeek multi-provider — 5-7 days, independent sprint
- F10 #95 context bloat experiment — needs a running app + time
- F12 #52 token bloat test — after F10
- F2 SkillManager UI mount — needs the Tauri Rust handler (skill_list/attach/detach)
- F4.2 per-specialist spend attribution

## 7. Active Order

**F1 progress (Option B implementation) — COMPLETE:**
- F1.1 ✅ commit a3e9a54 — AgentCard.svelte readOnly mode
- F1.2 ✅ commit 2c10eab — UI specialist chat surface removed
- F1.3a ✅ commit 91b3447 — Subprocess delegate tool surface deleted
- F1.3b ✅ commit 44e09d8 — specialist subprocess runtime fully deleted (-1055 lines)
- F1.4 ✅ commit d3fe596 — SubagentInline.svelte rich Agent tool card

**Next phases — COMPLETE:**
- Fix 104 + Fix 105 ✅ commit 7c57e83 — model slug + user_choice duplicate display
- F5 + F6 ✅ commit 59834b8 — project boundary + force CodeGraph
- F2 (skill system) ✅ commit 8901f10 — per-role skill loader + tools + SkillManager.svelte
- F3 (autonomous 3-day) ✅ commit 30ed094 — AutonomousManager + Notifier + JobMonitor.svelte (+1551 lines)
- F7 (durdur/duraklat semantics) ✅ commit a9e1ec6 — separate durdur from duraklat
- F4 (cost control) ✅ commit 399b7eb — BudgetManager + auto-fallback + BudgetCard.svelte
- F9 (main.ts split) ⏳ in progress — main.ts 3478 lines being split into sub-modules

**Not done yet (defer):**
- F8 #85 specialist error_during_execution — mooted by F1.3b; resolved (no subprocess)
- F10 #95 context bloat methodology — needs a running app, later
- F11 #74 DeepSeek multi-provider — 5-7 days, separate sprint
- F12 #52 Fix 68 token bloat test — after F10

**Target commit structure:**
- 1 commit per phase or sub-feature
- Conventional commits (feat:, refactor:, fix:)
- CLAUDE.md update when a phase is completed

---

## 8. Compact / Session Notes

- This plan document is the core source for post-compact recovery.
- At the start of each phase the task is in_progress in the TaskList, completed when done.
- Document important decisions in separate md files under `docs/`.
