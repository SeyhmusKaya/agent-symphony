# scripts/tests — Architect automated tests

Headless test set for Architect (a Tauri+Svelte+Node.js multi-agent orchestrator).
Two groups: **SPENDS TOKENS (live sef turn)** vs **ZERO-TOKEN (static)**.

All tests run from the repo root with `node`. `ws` and `better-sqlite3` are
available in node_modules. Each test prints a single `RESULT: PASS/FAIL/...` line
at the end and **always returns exit 0** (so the runner can aggregate; no hard-crash on assertion).

## Ports

| Project | Port |
|-------|------|
| Mimar (coordinator) | 4316 |
| EmlakCopilot (for live tests) | 4318 |
| google yorum | 4319 |

Live (WS) tests must be run **while the app / orchestrator is running**. Default port 4318.
You can redirect a test to another port via the `[port]` argv.

## Tests

| File | Type | What it does |
|-------|-----|----------|
| `_ws.mjs` | helper | Shared WS helper (connect, sendKomut/sendKontrol, collect, waitForCevap, watchSilence). Not a test. |
| `t01_codegraph_usage.mjs` | TOKEN | Fix 122: on a neutral code-search task, does the sef call codegraph (`code_*`/`search_docs`) FIRST, or Grep/Bash? |
| `t02_grep_allowed.mjs` | TOKEN | Fix 122: an EXPLICIT Grep request is not rejected; no "[KOD ARAMA YASAK]"/"reddedildi" in the io result, the turn completes. |
| `t03_stop.mjs` | TOKEN | Fix 120: after "durdur", 0 delta / 0 new activity in a 7s window. |
| `t04_token_baseline.mjs` | TOKEN | Fix 124: a single short command -> prints the last `sef_token` (liveIn/cacheRead/cacheCreate/usd). No assert. |
| `t05_static_checks.mjs` | ZERO-TOKEN | Fix 118 + codegraph bloat + Fix 122 source trace. No WS. |

## Running

### Zero-token (spends no tokens, run anytime)

```
node scripts/tests/t05_static_checks.mjs                                  # default EmlakCopilot
node scripts/tests/t05_static_checks.mjs "C:\Users\seyh\Desktop\projeler\EmlakCopilot"
```

Expected output (EmlakCopilot, verified):

```
[PASS] a) agents.json : 4 agents, all full slug [claude-sonnet-4-6, ...]
[PASS] b) codegraph.db : size=20.5MB files=1053 symbols=10219 edges=53637 docs=103 doc_chunks=1386
[PASS] c1) sdkHooks.ts : no active deny (clean)
[PASS] c2) runChiefAttempt.ts : no active deny (clean)
RESULT: PASS — all static checks passed
```

What `t05` verifies:
- (a) the models in `<root>/.team/agents.json` are **full slugs** (`claude-sonnet-4-6`), no bare `sonnet/opus/haiku`.
- (b) `<root>/.architect/codegraph.db` opens readonly; `files < 5000` and the file is `< 60MB` (old: 107MB / ~22k files).
- (c) in the **active code** of `orchestrator/sdkHooks.ts` and `orchestrator/chief/runChiefAttempt.ts` (excluding comments)
  neither the `[KOD ARAMA YASAK]` deny string nor a `canUseTool` deny assignment remains.

### Token-spending live tests (IN A JOINT SESSION — while the app is open)

These tests start a real sef turn and **spend API tokens**. During a joint test,
run them one by one while the EmlakCopilot orchestrator (4318) is running:

```
node scripts/tests/t01_codegraph_usage.mjs 4318
node scripts/tests/t02_grep_allowed.mjs 4318
node scripts/tests/t03_stop.mjs 4318
node scripts/tests/t04_token_baseline.mjs 4318
```

Notes:
- For `t04`, the cleanest cold-start measurement: first clear/refresh the sef session, then run.
- If `t01` returns "NO SEARCH", the task was answered by the sef from knowledge; clarify the task and try again.
- If `t03` returns "UNCLEAR — command never started", the sef may be busy/idle; try again.

## Manual UI tests

Checks that require UI-visual inspection and mid-turn recompilation (Fix 119/121/123, watchdog,
fast mode, subagent live visibility) cannot be automated -> see
`../../MANUAL-UI-TESTS.md` (at the repo root).
