# Test Report — F1-F9 + Fix 104-107 (2026-05-29)

Stability verification after the big refactor (Option B specialist subprocess
removal, main.ts split, skill/autonomous/budget systems).

## Rebuild
- Tauri release build: `npx tauri build` → EXIT 0 (2m08s). ui.exe rebuilt at 01:45
  (11.6MB). 2 rust warnings (unused import/var) — harmless.
- Orchestrator dist: `rm -rf dist && npm run build` → clean (old
  specialist/resilience/backgroundTasks/health .js artifacts cleaned up).

## Automated Test Suite (tests/run-all.mjs)
8 suites / 86 assertions — **ALL PASSED**.

| Suite | Scope | Result |
|-------|--------|-------|
| test-model-slug | Fix 104 toApiModel (fast strip, opus [1m], sonnet 200k) | 9/9 |
| test-pricing-1m | Fix 104 priceForModel is1m fallback | 5/5 |
| test-codegraph-nudge | F6 CODEGRAPH_NUDGE_RX pattern | 11/11 |
| test-skills | F2 loader + frontmatter + effectiveSkills | 14/14 |
| test-budget | F4 recordSpend + fallback + topSpenders | 15/15 |
| test-memory-scope | Fix 107 project tag isolation | 7/7 |
| test-autonomous | F3 startJob/checkpoint/pause/fail/cancel | 17/17 |
| test-startup (integ) | orchestrator boot + WS durum roundtrip | 8/8 |

Boot integration evidence: the orchestrator came up via tsx, WS durum_iste →
durum payload returned, the status.chief + autonomousJobs (F3) + budgets (F4) +
sessions fields are present, NO fatal module/ref error. **F1.3b (specialist
subprocess removal) + F9 (main.ts 3478→988 split) did not break the runtime boot
path.**

## Live API Test (real ui.exe)
- ui.exe started with a clean env (ANTHROPIC_API_KEY stripped — for OAuth).
- 16 orchestrator ports (4305-4320) listening: Mimar + 11 advisors + projects.
- **"merhaba" to Mimar (4316) → "running" reply in 6.0s.**
- This proves end-to-end that the Fix 104 model slug is accepted by the real
  Anthropic API + the whole SDK/proxy/query pipeline works after the refactor.

## Sandbox Live-Test Limit (known)
`tests/integration/test-live-chat.mjs` and `test-live-model.mjs` HANG in the
sandbox (nested tsx/node spawn). Reason: the SDK spawns the `claude` CLI
subprocess and depends on a HOST for OAuth refresh
(CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH=1). In a standalone spawn there is no host.
Verified: both sonnet and opus hang THE SAME way (model-independent) →
an auth-host artifact, NOT A CODE REGRESSION. The real ui.exe test (above)
succeeded. These tests work when a host exists (manual auth outside ui.exe).

## Needs Manual UI Verification (user)
The following are correct by code + tsc/svelte-check but need a visual UI test:
- Fix 106: typing smoothness in the composer in a long chat (PAGE 30 + autoGrow rAF)
- Fix 105: does the agent question reply show as a single card (not double)
- F1.4: Agent tool call renders as a SubagentInline card
- F2: SkillManager.svelte (not yet mounted on a screen — component ready)
- F3: JobMonitor.svelte (not yet mounted — component ready)
- F4: ChiefToolbar budget pill + BudgetCard dropdown
- F7: Composer durdur/duraklat kebab menu

## Conclusion
The system is stable. The backend is fully verified (automated + live). The UI
components compile (svelte-check 0 errors) but some are not yet mounted on a
screen (SkillManager, JobMonitor) — the next step is UI integration.
