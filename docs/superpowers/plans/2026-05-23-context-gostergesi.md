# Context Indicator and Message Cost — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a circular percentage indicator showing context fill to the Mimar/sef chats, and an in/out token cost line under each sef reply.

**Architecture:** On each assistant turn the orchestrator computes a context snapshot (`input + cache_read + cache_creation + output`) and sends it via a `sef_token` WS message; when a command finishes it sends the in/out cost from `result.usage` via the `sef_cevap` message. The UI store keeps these as session-persistent `contextTokens` and per-message `cost`; the new `ContextGauge.svelte` draws the ring, and `ChatThread.svelte` shows the cost line.

**Tech Stack:** Node.js + TypeScript (orchestrator), Svelte 5 + TypeScript (UI), WebSocket.

**Test note:** This project has no unit test framework. Verification for each task: `npm run typecheck` (root) for the orchestrator, `cd ui; npm run check` for the UI — both run via PowerShell (in bash `node`/`npm` are not on PATH). Expected: 0 errors.

---

### Task 1: Orchestrator — context snapshot and cost calculation (`runChiefAttempt`)

**Files:**
- Modify: `orchestrator/main.ts`

- [ ] **Step 1: add `cache_read_input_tokens` to the usage type**

The assistant usage type in the `runChiefAttempt` body in `orchestrator/main.ts` (≈line 465-472). This block:

```ts
        const u = (
          msg as {
            message?: {
              content?: unknown[];
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                cache_creation_input_tokens?: number;
              };
            };
          }
        ).message?.usage;
```

replace with:

```ts
        const u = (
          msg as {
            message?: {
              content?: unknown[];
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                cache_creation_input_tokens?: number;
                cache_read_input_tokens?: number;
              };
            };
          }
        ).message?.usage;
```

- [ ] **Step 2: compute the context snapshot and pass it to `onToken`**

At the same spot (≈474-480) this block:

```ts
        if (u) {
          liveTokens +=
            (u.input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.output_tokens ?? 0);
          onToken?.(liveTokens);
        }
```

replace with:

```ts
        if (u) {
          liveTokens +=
            (u.input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.output_tokens ?? 0);
          // Context fill — this turn's instantaneous prompt size (not a sum).
          const contextSnapshot =
            (u.input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.output_tokens ?? 0);
          onToken?.(liveTokens, contextSnapshot);
        }
```

- [ ] **Step 3: update the `onToken` signature and return type**

The `runChiefAttempt` signature (≈317-324). This line:

```ts
  onToken?: (tokens: number) => void,
): Promise<{ reply: string; transient: boolean; aktivite: ToolActivity[] }> {
```

replace with:

```ts
  onToken?: (tokens: number, context: number) => void,
): Promise<{
  reply: string;
  transient: boolean;
  aktivite: ToolActivity[];
  cost: { in: number; out: number };
}> {
```

- [ ] **Step 4: declare the cost variables**

In the `runChiefAttempt` body, right below the `let liveTokens = 0;` line (≈411), add:

```ts
  // The command's in/out cost — filled from result.usage.
  let costIn = 0;
  let costOut = 0;
```

- [ ] **Step 5: capture the cost in result**

While processing the `result` message, right below the `const sefIn = msg.usage.input_tokens + msg.usage.cache_creation_input_tokens;` line (≈530), add:

```ts
        costIn = sefIn;
        costOut = msg.usage.output_tokens;
```

- [ ] **Step 6: add cost to the return value**

The line at the end of `runChiefAttempt` (≈602):

```ts
  return { reply, transient, aktivite: [...toolMap.values()] };
```

replace with:

```ts
  return {
    reply,
    transient,
    aktivite: [...toolMap.values()],
    cost: { in: costIn, out: costOut },
  };
```

- [ ] **Step 7: typecheck**

Run via PowerShell: `npm run typecheck`
Expected: ERRORS due to the `onToken`/`sendChiefToken` mismatch (the call sites are not updated yet). This is expected — it will be fixed in later tasks. No other errors should occur.

---

### Task 2: Orchestrator — context and cost fields on WS messages (`server.ts`)

**Files:**
- Modify: `orchestrator/server.ts`

- [ ] **Step 1: update the `ServerMessage` type**

The `ServerMessage` union in `orchestrator/server.ts` (≈28-40). These two lines:

```ts
  | { kind: "sef_cevap"; commandId: string; text: string; aktivite?: ToolActivity[] }
```

```ts
  | { kind: "sef_token"; commandId: string; tokens: number }
```

replace respectively with:

```ts
  | {
      kind: "sef_cevap";
      commandId: string;
      text: string;
      aktivite?: ToolActivity[];
      cost?: { in: number; out: number };
    }
```

```ts
  | { kind: "sef_token"; commandId: string; tokens: number; context: number }
```

- [ ] **Step 2: update the `sendChiefReply` signature**

This method (≈91-93):

```ts
  sendChiefReply(commandId: string, text: string, aktivite?: ToolActivity[]): void {
    this.broadcast({ kind: "sef_cevap", commandId, text, aktivite });
  }
```

replace with:

```ts
  sendChiefReply(
    commandId: string,
    text: string,
    aktivite?: ToolActivity[],
    cost?: { in: number; out: number },
  ): void {
    this.broadcast({ kind: "sef_cevap", commandId, text, aktivite, cost });
  }
```

- [ ] **Step 3: update the `sendChiefToken` signature**

This method (≈108-110):

```ts
  sendChiefToken(commandId: string, tokens: number): void {
    this.broadcast({ kind: "sef_token", commandId, tokens });
  }
```

replace with:

```ts
  sendChiefToken(commandId: string, tokens: number, context: number): void {
    this.broadcast({ kind: "sef_token", commandId, tokens, context });
  }
```

- [ ] **Step 4: typecheck**

Via PowerShell: `npm run typecheck`
Expected: still ERRORS — the call sites in `main.ts` are not updated. Will finish in Task 3.

---

### Task 3: Orchestrator — wire the call sites (`main.ts`)

**Files:**
- Modify: `orchestrator/main.ts`

- [ ] **Step 1: update the `onToken` call in `runCommand`**

In the `runChiefAttempt` call inside `runCommand` (≈644) this line:

```ts
      (t) => server.sendChiefToken(cmd.id, t),
```

replace with:

```ts
      (t, ctx) => server.sendChiefToken(cmd.id, t, ctx),
```

- [ ] **Step 2: collect the cost in `runCommand`**

In `runCommand`, below the `let aktivite: ToolActivity[] = [];` line (≈633), add:

```ts
  let cost: { in: number; out: number } = { in: 0, out: 0 };
```

Then in the loop, below the `aktivite = r.aktivite;` line (≈647), add:

```ts
    cost = r.cost;
```

- [ ] **Step 3: send the reply with cost in `runCommand`**

The block at the end of `runCommand` (≈680-682):

```ts
  chatLog.push({ role: "sef", text: reply, ts: Date.now(), aktivite });
  saveChatLog();
  server.sendChiefReply(cmd.id, reply, aktivite);
```

replace with:

```ts
  chatLog.push({ role: "sef", text: reply, ts: Date.now(), aktivite, cost });
  saveChatLog();
  server.sendChiefReply(cmd.id, reply, aktivite, cost);
```

- [ ] **Step 4: update the `onToken` call in `runCompact`**

In the `runChiefAttempt` call inside `runCompact` (≈710) this line:

```ts
    (t) => server.sendChiefToken(cmd.id, t),
```

replace with:

```ts
    (t, ctx) => server.sendChiefToken(cmd.id, t, ctx),
```

- [ ] **Step 5: reset the context indicator on `runCompact` success**

In `runCompact`, in the success branch, right below the `chief.clearSessionId();` line (≈717), add:

```ts
      server.sendChiefToken(cmd.id, 0, 0);
```

- [ ] **Step 6: add `cost` to the `ChatEntry` interface**

`chatLog` is of type `ChatEntry[]`. The `ChatEntry` interface in `orchestrator/main.ts` (≈213-218):

```ts
interface ChatEntry {
  role: "kullanici" | "sef";
  text: string;
  ts: number;
  aktivite?: ToolActivity[];
}
```

replace with:

```ts
interface ChatEntry {
  role: "kullanici" | "sef";
  text: string;
  ts: number;
  aktivite?: ToolActivity[];
  cost?: { in: number; out: number };
}
```

- [ ] **Step 7: typecheck**

Via PowerShell: `npm run typecheck`
Expected: PASS — 0 errors.

- [ ] **Step 8: Commit**

```bash
git add orchestrator/main.ts orchestrator/server.ts
git commit -m "feat: context snapshot and message cost in orchestrator"
```

---

### Task 4: Store — types, contextTokens state, message handling (`store.svelte.ts`)

**Files:**
- Modify: `ui/src/lib/store.svelte.ts`

- [ ] **Step 1: add `cost` to the `ChatMessage` interface**

The `ChatMessage` interface in `ui/src/lib/store.svelte.ts` (≈46-52). This block:

```ts
export interface ChatMessage {
  role: "kullanici" | "sef";
  text: string;
  ts: number;
  aktivite?: ToolActivity[];
  images?: string[];
}
```

replace with:

```ts
export interface ChatMessage {
  role: "kullanici" | "sef";
  text: string;
  ts: number;
  aktivite?: ToolActivity[];
  images?: string[];
  cost?: { in: number; out: number };
}
```

- [ ] **Step 2: add `cost` to the `ServerReply` interface**

The `ServerReply` interface (≈87-92). This block:

```ts
interface ServerReply {
  kind: "sef_cevap";
  commandId: string;
  text: string;
  aktivite?: ToolActivity[];
}
```

replace with:

```ts
interface ServerReply {
  kind: "sef_cevap";
  commandId: string;
  text: string;
  aktivite?: ToolActivity[];
  cost?: { in: number; out: number };
}
```

- [ ] **Step 3: add `context` to the `ServerToken` interface**

The `ServerToken` interface (≈116-120). This block:

```ts
interface ServerToken {
  kind: "sef_token";
  commandId: string;
  tokens: number;
}
```

replace with:

```ts
interface ServerToken {
  kind: "sef_token";
  commandId: string;
  tokens: number;
  context: number;
}
```

- [ ] **Step 4: add the `contextTokens` state and the `contextWindow` getter**

Below the `runTokens = $state(0);` line (≈144), add:

```ts
  contextTokens = $state(0);
```

Then below the `chiefEffort = $state("medium");` line (≈146), add a new getter:

```ts
  get contextWindow(): number {
    return this.chiefModel.includes("[1m]") ? 1_000_000 : 200_000;
  }
```

- [ ] **Step 5: reset `contextTokens` on connection reset**

In the reset block, below the `this.tokensOut = 0;` line (≈197), add:

```ts
      this.contextTokens = 0;
```

- [ ] **Step 6: update `contextTokens` on the `sef_token` message**

The `sef_token` handling block (≈339-341). This block:

```ts
    } else if (msg.kind === "sef_token") {
      // Calisma sirasinda anlik token sayaci.
      if (this.running) this.runTokens = msg.tokens;
```

replace with:

```ts
    } else if (msg.kind === "sef_token") {
      // Instantaneous token counter while running.
      if (this.running) this.runTokens = msg.tokens;
      // Context fill — session-persistent, not tied to the running condition.
      this.contextTokens = msg.context;
```

- [ ] **Step 7: write `cost` to the message on the `sef_cevap` message**

The `sef_cevap` handling block (≈315-327). This block:

```ts
    } else if (msg.kind === "sef_cevap") {
      if (this.streamIdx >= 0 && this.chat[this.streamIdx]) {
        this.chat[this.streamIdx].text = msg.text;
        this.chat[this.streamIdx].aktivite = msg.aktivite;
        this.chat = [...this.chat];
      } else {
        this.chat.push({
          role: "sef",
          text: msg.text,
          ts: Date.now(),
          aktivite: msg.aktivite,
        });
      }
```

replace with:

```ts
    } else if (msg.kind === "sef_cevap") {
      if (this.streamIdx >= 0 && this.chat[this.streamIdx]) {
        this.chat[this.streamIdx].text = msg.text;
        this.chat[this.streamIdx].aktivite = msg.aktivite;
        this.chat[this.streamIdx].cost = msg.cost;
        this.chat = [...this.chat];
      } else {
        this.chat.push({
          role: "sef",
          text: msg.text,
          ts: Date.now(),
          aktivite: msg.aktivite,
          cost: msg.cost,
        });
      }
```

- [ ] **Step 8: check**

Via PowerShell: `cd ui; npm run check`
Expected: "0 ERRORS 0 WARNINGS".

- [ ] **Step 9: Commit**

```bash
git add ui/src/lib/store.svelte.ts
git commit -m "feat: store context and message cost fields"
```

---

### Task 5: New component — `ContextGauge.svelte`

**Files:**
- Create: `ui/src/lib/ui/ContextGauge.svelte`

- [ ] **Step 1: Create the component**

Create `ui/src/lib/ui/ContextGauge.svelte` with this content:

```svelte
<script lang="ts">
  let { used = 0, total = 1 }: { used?: number; total?: number } = $props();

  const pct = $derived(
    total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0,
  );
  const R = 9;
  const CIRC = 2 * Math.PI * R;
  const dash = $derived((pct / 100) * CIRC);
  const tone = $derived(pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok");

  function fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
    return String(n);
  }

  const tip = $derived(
    `${fmt(used)} / ${fmt(total)} context · ${fmt(Math.max(0, total - used))} left`,
  );
</script>

<div class="gauge" class:danger={tone === "danger"} class:warn={tone === "warn"} title={tip}>
  <svg viewBox="0 0 24 24" width="24" height="24">
    <circle class="track" cx="12" cy="12" r={R} />
    <circle
      class="prog"
      cx="12"
      cy="12"
      r={R}
      stroke-dasharray="{dash} {CIRC}"
      transform="rotate(-90 12 12)"
    />
  </svg>
  <span class="pct">%{pct}</span>
</div>

<style>
  .gauge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: default;
  }
  svg {
    flex: none;
  }
  .track {
    fill: none;
    stroke: var(--arc-n200);
    stroke-width: 3;
  }
  .prog {
    fill: none;
    stroke: var(--arc-primary);
    stroke-width: 3;
    stroke-linecap: round;
    transition: stroke-dasharray 0.4s var(--arc-ease), stroke 0.3s var(--arc-ease);
  }
  .warn .prog {
    stroke: var(--arc-warn);
  }
  .danger .prog {
    stroke: var(--arc-danger);
  }
  .pct {
    font-size: 11px;
    font-family: var(--arc-mono);
    font-weight: 600;
    color: var(--arc-text-soft);
  }
  .warn .pct {
    color: var(--arc-warn);
  }
  .danger .pct {
    color: var(--arc-danger);
  }
</style>
```

- [ ] **Step 2: check**

Via PowerShell: `cd ui; npm run check`
Expected: "0 ERRORS 0 WARNINGS".

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/ui/ContextGauge.svelte
git commit -m "add: ContextGauge circular indicator component"
```

---

### Task 6: Place the indicator in the `GlobalChief.svelte` header

**Files:**
- Modify: `ui/src/lib/GlobalChief.svelte`

- [ ] **Step 1: import ContextGauge**

Add next to the imports at the top of the `GlobalChief.svelte` `<script>` block (below an existing `import ... from "$lib/ui/...";` line):

```ts
  import ContextGauge from "$lib/ui/ContextGauge.svelte";
```

- [ ] **Step 2: add the indicator to the header**

The badge block inside `<header class="gc-head">` (≈166-174):

```svelte
    {#if session.running}
      <Badge variant="soft" tone="primary" dot pulse>
        Running · {fmtElapsed(session.runElapsed)} · {session.runTokens.toLocaleString("tr-TR")} tk
      </Badge>
    {:else if session.connected}
      <Badge variant="soft" tone="ok" dot>Connected</Badge>
    {:else}
      <Badge variant="soft" tone="warn" dot pulse>Connecting…</Badge>
    {/if}
```

replace with:

```svelte
    <div class="gc-head-right">
      <ContextGauge used={session.contextTokens} total={session.contextWindow} />
      {#if session.running}
        <Badge variant="soft" tone="primary" dot pulse>
          Running · {fmtElapsed(session.runElapsed)} · {session.runTokens.toLocaleString("tr-TR")} tk
        </Badge>
      {:else if session.connected}
        <Badge variant="soft" tone="ok" dot>Connected</Badge>
      {:else}
        <Badge variant="soft" tone="warn" dot pulse>Connecting…</Badge>
      {/if}
    </div>
```

- [ ] **Step 3: add the `gc-head-right` style**

In the `GlobalChief.svelte` `<style>` block, right below the `.gc-head` rule, add:

```css
  .gc-head-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }
```

- [ ] **Step 4: check**

Via PowerShell: `cd ui; npm run check`
Expected: "0 ERRORS 0 WARNINGS".

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/GlobalChief.svelte
git commit -m "feat: context indicator in the Mimar header"
```

---

### Task 7: Place the indicator in the `ProjectScreen.svelte` header

**Files:**
- Modify: `ui/src/lib/ProjectScreen.svelte`

- [ ] **Step 1: import ContextGauge**

Add next to the imports in the `ProjectScreen.svelte` `<script>` block:

```ts
  import ContextGauge from "$lib/ui/ContextGauge.svelte";
```

- [ ] **Step 2: add the indicator next to the `tb-metric` block**

The `tb-metric` block (≈371-377):

```svelte
      <div class="tb-metric">
        <span class="arc-caption">Token</span>
        <span class="tb-metric-val">
          <span class="tok-up">▲ {fmtTokens(session.tokensIn)}</span>
          <span class="tok-down">▼ {fmtTokens(session.tokensOut)}</span>
        </span>
      </div>
```

right BELOW this block (after the closing `</div>`), add:

```svelte
      <div class="tb-metric">
        <span class="arc-caption">Context</span>
        <span class="tb-metric-val">
          <ContextGauge used={session.contextTokens} total={session.contextWindow} />
        </span>
      </div>
```

- [ ] **Step 3: check**

Via PowerShell: `cd ui; npm run check`
Expected: "0 ERRORS 0 WARNINGS".

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/ProjectScreen.svelte
git commit -m "feat: context indicator in the project header"
```

---

### Task 8: `ChatThread.svelte` — per-message cost line

**Files:**
- Modify: `ui/src/lib/ui/ChatThread.svelte`

- [ ] **Step 1: add the `fmtCost` helper**

In the `ChatThread.svelte` `<script>` block, below the `fmtTime` function (≈71-76), add:

```ts
  function fmtTok(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
    return String(n);
  }
```

- [ ] **Step 2: add the cost line to the end of the sef message**

Between the tool dump `{/if}` and `</div>` in the sef (`assist`) message (≈157-158). This block:

```svelte
              {#if m.aktivite && m.aktivite.length}
                <details class="tools">
```

After the `</details>` and its closing `{/if}`, BEFORE the `</div>` that closes `.turn.assist` — i.e. the existing:

```svelte
                </details>
              {/if}
            </div>
```

replace with:

```svelte
                </details>
              {/if}
              {#if m.cost && (m.cost.in > 0 || m.cost.out > 0)}
                <div class="cost" title="Token cost of this reply">
                  in {fmtTok(m.cost.in)} / out {fmtTok(m.cost.out)}
                </div>
              {/if}
            </div>
```

- [ ] **Step 3: add the `.cost` style**

In the `ChatThread.svelte` `<style>` block, below the `.assist-name` rule, add:

```css
  .cost {
    align-self: flex-start;
    font-size: 10.5px;
    font-family: var(--arc-mono);
    color: var(--arc-text-faint);
    margin-top: 2px;
  }
```

- [ ] **Step 4: check**

Via PowerShell: `cd ui; npm run check`
Expected: "0 ERRORS 0 WARNINGS".

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/ui/ChatThread.svelte
git commit -m "feat: per-message token cost in chat"
```

---

### Task 9: Integrated verification and restart

**Files:** none (verification task)

- [ ] **Step 1: Orchestrator typecheck**

Via PowerShell: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: UI check and build**

Via PowerShell: `cd ui; npm run check` → "0 ERRORS 0 WARNINGS".
Then: `cd ui; npm run build` → should complete without errors.

- [ ] **Step 3: merge into master**

All task commits are already on master (if a separate branch was not used). If work was done on a `mimar/auto/*` branch, merge into master:

```bash
git checkout master && git merge --no-ff -
```

- [ ] **Step 4: restart_self**

The orchestrator code changed. Call the `restart_self` tool with the `not` parameter: "context indicator and message cost added". If the new build does not come up in 45s it automatically rolls back.

- [ ] **Step 5: verify health**

After restart, verify the Mimar session is connected. Send a test message; observe that the context percentage shows in the header and the `in X / out Y` line appears under the reply (ask the user to confirm).

- [ ] **Step 6: push**

After health is verified: `git push origin master`.

---

## Notes

- Order matters: Task 1-2 alone break typecheck (expected); Task 3 fixes it. Task 1-3 finish in a single commit.
- `restart_self` only in Task 9, once all UI+orchestrator changes are done.
- After `/compact` the indicator drops to 0 (thanks to Task 3 Step 5); it fills with the real context value on the next command.
