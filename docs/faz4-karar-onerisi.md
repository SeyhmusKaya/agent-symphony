# Phase 4 Decision — Persistent Specialist Chat UI Semantics

Phase 4 = elimination of the specialist subprocess (specialist.ts + resilience.ts +
health.ts + backgroundTasks.ts). Big regression risk: the "the user can chat directly
with a specialist" UX, like Volpora, currently works thanks to the subprocess
(sessionId persist + WebSocket stream). The native Agent tool is one-off
(sef call → result → exit).

## Current State

In the UI, "switch to specialist mode" (ProjectScreen left panel, the specialist's
card → click):
- The sef's chat screen closes, and a separate ChatThread + Composer opens for the
  selected specialist.
- The user writes DIRECTLY to the specialist — bypassing the sef.
- Backend: `session.sendToAgent(name, text)` → sends to the specialist via the
  runSpecialistResilient subprocess SDK. sessionId persist; each message resumes.
- Output: all the specialist's activity (tool chain, transcript, token usage) is in
  the specialistLive[name] state — it streams live in the UI.

This is an actively used feature right now: long-lived specialists like Volpora keep
"configuration memory".

## 3 Options

### Option A: KEEP the persistent specialist chat UI (status quo + Phase 1 hybrid)

- The specialist subprocess (specialist.ts, resilience.ts) stays.
- The sef prefers the Agent tool for "one-off parallel work" (Phase 1+2 already
  done). delegate only for cases where the user follows the specialist in the chat
  screen.
- Phase 4 = just documentation cleanup + strengthening the "prefer Agent" prompt.

**Pro:** Volpora UX is not broken. Zero risk.
**Con:** ~1000 lines of code are not deleted. No RAM savings. Deviates from the
Phase 4 goal.

### Option B: REMOVE the persistent chat UI — Go Through the Sef

- The specialist chat screen goes away. The user writes "frontend specialist, do X"
  to the sef; the sef spawns via the Agent tool and the result comes back.
- The UI specialist card = read-only transcript history (past Agent calls).
- specialist.ts/resilience.ts/health.ts/runSpecialistResilient are deleted.
  Roughly 1500 lines of code.

**Pro:** The Phase 4 goal is met. Zero cold-start cache explosion. 500MB-1GB RAM
savings. End of cross-platform spawn bugs.
**Con:** Major UX change. The user who uses Volpora (you) gives up the "chat with a
specialist" feature. For specialists with complex configuration memory, the cost of
re-passing context to the sef over and over.

### Option C: Port to the Managed Agents API (full Phase 4 goal)

- Use Anthropic Managed Agents (Q2 2026 hosted) instead of the specialist subprocess.
  The persistent session API is native — the UI specialist chat works as-is but the
  backend is at Anthropic.
- Architect's Sef-Specialist logic does not change; only the runtime is handed to
  Anthropic.
- New documentation: Managed Agents REST API + event log + session resume.

**Pro:** The Phase 4 goal is fully met + Volpora UX is preserved. The operational
load is entirely at Anthropic.
**Con:** Anthropic Managed Agents is still new (April 2026). Unclear if it is stable.
Architect drifts away from its "local-first" philosophy. Billing goes through
Anthropic — less control. Implementation 1-2 weeks.

## My Recommendation

**Stage 1 (now):** Option A — Phase 1+2+3 are already done. Phase 4 is
DOCUMENTATION for now. Add a "FUTURE: to be ported to Managed Agents" comment to the
specialist.ts files.

**Stage 2 (3-6 months):** Option C — port once Anthropic Managed Agents matures.
Volpora UX is preserved, the code is simplified.

**Never Option B**: the persistent chat is the user's core communication path —
removing it is a big UX regression.

## Decision Pending

Which one:
- [A] Status quo + Phase 4 documentation only — commit now.
- [B] Remove the persistent chat, fully move to Agent — big PR.
- [C] Managed Agents port plan — in 3-6 months.
