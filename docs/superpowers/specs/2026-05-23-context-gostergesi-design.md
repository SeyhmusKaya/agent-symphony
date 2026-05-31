# Context Usage Indicator — Design

Date: 2026-05-23

## Purpose

A circular percentage indicator, like the one in Claude Code, in the Mimar and
project sef chats. It shows in real time how much of the context window is full;
on hover, a tooltip gives the "used / remaining" token info.

## Problem

The current `sef_token` mechanism sends `liveTokens`: a cumulative counter that
sums each assistant turn's `input + cache_creation + output` tokens. This is NOT
context window fill — it is a total accumulated over multiple turns. Also,
`runTokens` is reset on every command; but context accumulates over the session.

## Correct Metric

Context fill = the instantaneous snapshot of the latest assistant turn:

```
context = input_tokens + cache_read_input_tokens
        + cache_creation_input_tokens + output_tokens
```

This is that turn's prompt size (input + cache) plus the produced output;
approximately equal to the next turn's context base. It is NOT summed across
turns — the value is recomputed on each assistant message (the last turn's
snapshot is the valid one).

## Scope

### Orchestrator

- Add `cache_read_input_tokens` to the assistant usage type in `main.ts`.
- Compute a `context` snapshot on each assistant turn (assignment, not a sum).
- The `onToken` callback also passes the `context` value.
- Add a `context: number` field to `server.ts` `sendChiefToken` and the
  `sef_token` message.
- `liveTokens` (cumulative token for the running badge) is kept — separate purpose.

### Store (`store.svelte.ts`)

- New field: `contextTokens = $state(0)` — session-persistent context fill.
- When the `sef_token` message is handled, `contextTokens = msg.context` (always,
  not tied to the `running` condition — the last value should stay on screen).
- `contextTokens` is reset: on session reset and after `/compact`. PRESERVED
  between commands.
- The context window is derived from `chiefModel`: if the name contains `[1m]`,
  1,000,000, otherwise 200,000. New getter: `contextWindow`.
- Add `context: number` to the `ServerToken` interface.

### UI component — `ContextGauge.svelte`

- An SVG circular progress ring (via stroke-dasharray).
- A percentage text inside (e.g. `%37`).
- Color thresholds: `< 70%` green, `70-90%` amber, `> 90%` red
  (consistent with the `app.css` theme variables).
- Native tooltip via the `title` attribute: `"147k / 1M · 853k left"`
  (k/M abbreviation; uses the existing `fmtTokens` helper or similar).
- Props: `used: number`, `total: number`.

### Placement

- `GlobalChief.svelte`: a gauge next to the agent name in the chat header — visible
  both while running and idle.
- `ProjectScreen.svelte`: likewise in the sef chat header.
- The gauge is fed by `session.contextTokens` and `session.contextWindow`.

## Extra Feature: Per-Message Token Cost

A small line at the bottom-left under each sef reply: how many tokens that reply
cost. Format: `in 400 / out 2.1k`.

- `in` = that command's `result.usage.input_tokens + cache_creation_input_tokens`
  (EXCLUDING cache_read — newly written input; so a small number).
- `out` = `result.usage.output_tokens`.
- These values are already computed in `main.ts` on the `result` message as `sefIn`
  and `msg.usage.output_tokens`.

### Scope — cost

- Add `cost: { in: number; out: number }` to the chief runner (`runChief`) return
  value.
- `handleCommand` passes this value to `server.sendChiefReply`.
- Add `cost?: { in: number; out: number }` to the `server.ts` `sef_cevap` message.
- Add `cost?: { in: number; out: number }` to the `ChatMessage` interface; also
  written to `chatLog` (preserved on reload).
- When the store handles `sef_cevap`, `chat[idx].cost = msg.cost`.
- `ChatThread.svelte`: a small, faint left-aligned line under the `sef`-role message
  — `in 400 / out 2.1k`. With `k`/`M` abbreviation in a format similar to the
  existing `fmtTokens`. If there is no `cost`, the line is hidden.
- Note-type replies (`sendChiefReply(cmd.id, note, [])`) have no `cost` — optional.

## Success Criteria

- While talking with the Mimar/sef, a circular percentage indicator shows in the header.
- As turns complete, the percentage reflects the real context fill (not the
  incorrect cumulative total).
- On hover, a "used k / total · remaining k" tooltip appears.
- After `/compact`, the percentage drops noticeably.
- An `in X / out Y` cost line shows at the bottom-left of each sef reply.
- `npm run typecheck` and `ui` `npm run check` zero errors.

## Out of Scope

- Worker (sonnet) context indicator.
- Automatic compact triggering.
- Context history/chart.
