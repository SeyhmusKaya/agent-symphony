import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocket } from "ws";
import {
  Fleet,
  listAllProjects,
  readProjectInfo,
  type RunningEntry,
} from "./fleet.js";
import { ADVISORS, resolveAdvisor } from "./advisors.js";

const ORCH_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "main.ts");
const REPO_ROOT = dirname(dirname(ORCH_ENTRY));

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface ProjectTarget {
  id: string;
  name: string;
  path: string;
}

export function resolveProject(query: string): ProjectTarget | null {
  const q = query.trim().toLowerCase();
  const projects = listAllProjects();
  const hit =
    projects.find((p) => p.id === query || p.name.toLowerCase() === q) ??
    projects.find((p) => p.name.toLowerCase().includes(q));
  return hit ? { id: hit.id, name: hit.name, path: hit.path } : null;
}

async function ensureProjectRunning(
  fleet: Fleet,
  projectId: string,
  projectPath: string,
): Promise<RunningEntry> {
  const existing = fleet.get(projectId);
  if (existing) return existing;
  const port = fleet.freePort();
  // main.ts arg3 = project PATH (cwd). projectId matches from fleet.json.
  const child = spawn(
    "node",
    ["--import", "tsx", ORCH_ENTRY, String(port), projectPath],
    { cwd: REPO_ROOT, detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  for (let i = 0; i < 40; i++) {
    await delay(500);
    const e = fleet.get(projectId);
    if (e) return e;
  }
  throw new Error(`Target orchestrator could not be started: ${projectId} (path: ${projectPath})`);
}

async function probePort(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const t = setTimeout(() => { try { ws.close(); } catch {} resolve(false); }, timeoutMs);
    ws.on("open", () => { clearTimeout(t); try { ws.close(); } catch {} resolve(true); });
    ws.on("error", () => { clearTimeout(t); resolve(false); });
  });
}

// Advisor lazy-spawn — spawn if nobody is on the advisor port.
async function ensureAdvisorRunning(advisorKey: string, advisorPort: number): Promise<void> {
  if (await probePort(advisorPort)) return;
  // main.ts arg3 = "--advisor", arg4 = key.
  const child = spawn(
    "node",
    ["--import", "tsx", ORCH_ENTRY, String(advisorPort), "--advisor", advisorKey],
    { cwd: REPO_ROOT, detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  for (let i = 0; i < 30; i++) {
    await delay(500);
    if (await probePort(advisorPort, 400)) return;
  }
  throw new Error(`Advisor could not be started: ${advisorKey}`);
}

export interface CrossReply {
  text: string;
  // M8: so the caller can reflect token spend in the UI, we return the target
  // agent's cost (USD + in/out) from sef_cevap. undefined if absent.
  cost?: {
    in?: number;
    out?: number;
    cacheRead?: number;
    cacheCreate1h?: number;
    usd?: number;
    model?: string;
  };
}

// Fix 79: cross-agent error categories. Written into talkToChief response.text
// in the format "[CATEGORY] description"; the caller (Architect/chief) decides
// based on this prefix — is retry sensible, notify the user, or silently change
// strategy.
//   advisor_down  : target port not up at all (spawn failed)
//   timeout       : ABSOLUTE_TIMEOUT (15 min) elapsed
//   lost_turn     : 2x busy=false to durum_iste, no sef_cevap arrived
//   ws_closed     : WebSocket closed early (network/process error)
//   ws_error      : WebSocket error event (usually ECONNREFUSED)
//   throttle      : Anthropic 429 — effectively give the caller a retry-after
//   project_self  : chief called its own project (already caught by Fix 48)
//   project_404   : the given query did not match any project/advisor
//   other         : uncategorized
export type CrossError =
  | "advisor_down"
  | "timeout"
  | "lost_turn"
  | "ws_closed"
  | "ws_error"
  | "throttle"
  | "project_self"
  | "advisor_self"
  | "project_404"
  | "spawn_fail"
  | "other";

class CrossCallError extends Error {
  constructor(public code: CrossError, message: string) {
    super(message);
    this.name = "CrossCallError";
  }
}

function classifyError(e: unknown): CrossError {
  if (e instanceof CrossCallError) return e.code;
  const m = (e as Error | undefined)?.message ?? "";
  if (/429|rate.?limit|throttle|overloaded/i.test(m)) return "throttle";
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(m)) return "advisor_down";
  return "other";
}

// Fix 54: identity clarity in cross-agent messages. The target agent sees who
// wrote it, from which project, from which session in a SYSTEM-VERIFIED way —
// preventing the caller from equivocating with phrasing like "an agent" in the
// text. The same metadata in error reporting (reportToMimar), critical for error tracing.
export interface CallerIdentity {
  kind: "mimar" | "sef" | "advisor" | "uzman" | "worker";
  name: string;            // display name: "Volpora", "Marketing Specialist", etc.
  projectId?: string;      // project id (if any)
  sessionId?: string;      // active session id (if any)
  // Fix 82: advisor self-call detection — set on the advisor caller.
  advisorKey?: string;
  // If this message is forwarded from another agent, the original source — bug tracing.
  forwardedFrom?: CallerIdentity;
}

function kindLabel(k: CallerIdentity["kind"]): string {
  switch (k) {
    case "mimar": return "Head Architect";
    case "sef": return "Project Chief";
    case "advisor": return "Advisor";
    case "uzman": return "Specialist";
    case "worker": return "Worker";
  }
}

export function buildIdentityPrefix(c: CallerIdentity): string {
  const lines: string[] = [];
  lines.push("[CALLING AGENT — system-verified]");
  lines.push(`- Type: ${kindLabel(c.kind)}`);
  lines.push(`- Name: ${c.name}`);
  if (c.projectId) lines.push(`- Project ID: ${c.projectId}`);
  if (c.sessionId) lines.push(`- Session ID: ${c.sessionId}`);
  if (c.forwardedFrom) {
    lines.push("");
    lines.push("[ORIGINAL SOURCE — this message is being forwarded by the caller]");
    lines.push(`- Type: ${kindLabel(c.forwardedFrom.kind)}`);
    lines.push(`- Name: ${c.forwardedFrom.name}`);
    if (c.forwardedFrom.projectId) lines.push(`- Project ID: ${c.forwardedFrom.projectId}`);
    if (c.forwardedFrom.sessionId) lines.push(`- Session ID: ${c.forwardedFrom.sessionId}`);
  }
  lines.push("");
  lines.push("[MESSAGE — written by the caller]");
  return lines.join("\n") + "\n";
}

export function sendCommandAwait(
  port: number,
  text: string,
  caller: CallerIdentity,
): Promise<CrossReply> {
  // Fix 54: the identity prefix is added by the system, preventing the caller
  // from equivocating with phrasing like "an agent" within the text.
  const wrappedText = buildIdentityPrefix(caller) + text;
  const fromAgent = caller.name;
  return new Promise<CrossReply>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    let done = false;
    let lastActivity = Date.now();
    // M5: health-check. If the target agent is not sending sef_parcali/activity/
    // token signals, suspect no reply is coming — check with a durum_iste ping.
    // If busy=false it has lost the turn, return an error.
    // Fix 79: STALE_MS 120 -> 180sn. Most of talk_to_chief's 69% failures were
    // false-positive "lost turns" — between advisor turns it briefly entered a
    // busy=false window and the heartbeat caught that moment. With 180sn the
    // agent's sef_cevap broadcast arrives before the check window elapses.
    const HEARTBEAT_MS = 30_000;
    const STALE_MS = 180_000;
    const ABSOLUTE_TIMEOUT = 15 * 60 * 1000;
    // P1.26: the target agent sends a `durum` payload as soon as the WS connects
    // (server.ts:157). The old code mistook this first durum for a durum_iste
    // reply and rejected with "lost turn" the moment it saw busy=false — error
    // within 21ms. Solution: track when durum_iste was sent; do NOT count `durum`
    // messages from before it was sent as health-check replies.
    let lastPingTs = 0;
    // P1.26: false-positive guard — retry after a durum busy=false (10sn).
    // If still busy=false it is truly lost; otherwise continue.
    let pendingBusyFalseAt = 0;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(absoluteTimer);
      clearInterval(healthTimer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      fn();
    };
    const absoluteTimer = setTimeout(
      () => finish(() => reject(new CrossCallError("timeout", "timed out (15 min)"))),
      ABSOLUTE_TIMEOUT,
    );
    const healthTimer = setInterval(() => {
      if (done) return;
      const idle = Date.now() - lastActivity;
      if (idle < STALE_MS) return;
      // No signal for 120sn. Query the agent's status.
      try {
        ws.send(JSON.stringify({ kind: "durum_iste" }));
        lastPingTs = Date.now();
      } catch {
        /* ignore */
      }
    }, HEARTBEAT_MS);
    ws.on("open", () =>
      ws.send(
        // P1.33: routeToIdle=true -> the backend routes to an empty session
        // (primary > secondary idle > new session). Two parallel cross-agent
        // calls to the same target are distributed across different sessions.
        // Fix 54: wrappedText instead of text — caller identity prepended.
        JSON.stringify({ kind: "komut", text: wrappedText, agentCall: true, fromAgent, routeToIdle: true }),
      ),
    );
    // P1.33: the commandId the caller expects. Comes from the backend via the
    // komut_alindi event. sef_cevap broadcasts are filtered by commandId; if a
    // reply belongs to another session it is IGNORED.
    let expectedCommandId: string | null = null;
    // Fix 79: race guard — a sef_cevap that arrives before komut_alindi MAY
    // belong to another command (a parallel call from the UI, another
    // cross-agent request, etc). The old code fell into the LEGACY fallback when
    // expectedCommandId===null and could resolve the wrong text. New behavior:
    // buffer the pendingReply, and once komut_alindi arrives check if it matches;
    // if not, drop silently. If komut_alindi does not arrive within 2sn we could
    // fall back to the default (old legacy) — but in practice it is sent right
    // after onCommand returns (server.ts:253), so the delay is negligible.
    const pendingReplies: Array<{ text: string; commandId?: string; cost?: CrossReply["cost"] }> = [];
    let komutAlindi = false;
    const tryFlushPending = () => {
      // After komut_alindi arrives, compare the commandId of pending sef_cevap
      // messages with the real expectedCommandId. Take the first match, drop the rest.
      while (pendingReplies.length) {
        const m = pendingReplies.shift()!;
        if (expectedCommandId && m.commandId === expectedCommandId) {
          finish(() => resolve({ text: m.text, cost: m.cost }));
          return;
        }
      }
    };
    ws.on("message", (raw) => {
      let msg: {
        kind?: string;
        text?: string;
        commandId?: string;
        sessionId?: string;
        cost?: CrossReply["cost"];
        payload?: { busy?: boolean; queue?: Array<{ status: string }> };
      };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      lastActivity = Date.now();
      if (msg.kind === "komut_alindi" && msg.commandId) {
        expectedCommandId = msg.commandId;
        komutAlindi = true;
        // Buffer'da bekleyen sef_cevap eslesir mi?
        tryFlushPending();
        return;
      }
      if (msg.kind === "sef_cevap") {
        // Fix 79: if komut_alindi has not arrived, buffer it — race guard.
        if (!komutAlindi) {
          pendingReplies.push({ text: msg.text ?? "", commandId: msg.commandId, cost: msg.cost });
          // Limit the buffer — protect memory during a sef_cevap storm.
          if (pendingReplies.length > 16) pendingReplies.shift();
          return;
        }
        // After komut_alindi: resolve ONLY on a match. If no match it is a
        // broadcast belonging to another command — ignore.
        if (expectedCommandId && msg.commandId !== expectedCommandId) return;
        finish(() => resolve({ text: msg.text ?? "", cost: msg.cost }));
      } else if (msg.kind === "durum" && msg.payload) {
        // P1.26: if we did NOT send durum_iste this message is the snapshot from
        // the first connect — not a health check. Ignore.
        if (lastPingTs === 0) return;
        const p = msg.payload;
        const stillBusy =
          p.busy === true ||
          (Array.isArray(p.queue) && p.queue.some((c) => c.status === "isleniyor"));
        if (stillBusy) {
          pendingBusyFalseAt = 0;
          return;
        }
        // busy=false — may be a false-positive (turn just ended, response in
        // flight). Send a second ping within 10sn; if still busy=false it is real.
        if (pendingBusyFalseAt === 0) {
          pendingBusyFalseAt = Date.now();
          setTimeout(() => {
            if (done) return;
            try {
              ws.send(JSON.stringify({ kind: "durum_iste" }));
              lastPingTs = Date.now();
            } catch {
              /* ignore */
            }
          }, 10_000);
          return;
        }
        if (Date.now() - pendingBusyFalseAt < 9_500) return; // retry too close, wait
        // A real lost turn.
        finish(() =>
          reject(
            new CrossCallError(
              "lost_turn",
              "agent is not responding (durum_iste: busy=false, lost turn)",
            ),
          ),
        );
      }
    });
    ws.on("error", (e) => {
      const err = e as Error & { code?: string };
      const code: CrossError =
        err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" ? "advisor_down" : "ws_error";
      finish(() => reject(new CrossCallError(code, err.message || "ws error")));
    });
    ws.on("close", () =>
      finish(() => reject(new CrossCallError("ws_closed", "connection closed (no reply)"))),
    );
  });
}

export interface TalkResult {
  ok: boolean;
  text: string;
  hedef: string;
  cost?: CrossReply["cost"];
  // By checking this flag the caller can trigger context-cleanup (auto-compact)
  // after an advisor interaction. Advisors usually produce long replies — the
  // project chief's context is refreshed with a compact summary before it bloats.
  isAdvisor?: boolean;
  // Fix 79: error category (for the caller's retry decision).
  errorCode?: CrossError;
  retried?: boolean;
}

// Fix 79: which errors can be retried once? Logic:
//   - lost_turn       : may be a false-positive, a real reply may come on retry
//   - ws_closed       : the agent may have restarted, try a second time
//   - ws_error        : other than ECONNREFUSED: reconnect
//   - advisor_down    : let ensureAdvisorRunning trigger once more
//   - throttle        : 429 — wait briefly, retry
// timeout (15 min) is not retried — it would wait another 15 min. lost_turn also
// takes 30sn+ in practice; should stay within a 60sn total window. retry COUNT: 1.
function isRetriable(code: CrossError): boolean {
  return (
    code === "lost_turn" ||
    code === "ws_closed" ||
    code === "ws_error" ||
    code === "advisor_down" ||
    code === "throttle"
  );
}

async function callAdvisorOnce(
  caller: CallerIdentity,
  advisorKey: string,
  advisorPort: number,
  message: string,
): Promise<CrossReply> {
  // If the advisor port is not open, spawn, then send the command. If spawn does
  // not come up within 15sn, fail in the advisor_down category.
  try {
    await ensureAdvisorRunning(advisorKey, advisorPort);
  } catch (e) {
    throw new CrossCallError("advisor_down", (e as Error).message);
  }
  return sendCommandAwait(advisorPort, message, caller);
}

async function callProjectOnce(
  fleet: Fleet,
  caller: CallerIdentity,
  targetId: string,
  targetPath: string,
  message: string,
): Promise<{ reply: CrossReply; entry: RunningEntry }> {
  const entry = await ensureProjectRunning(fleet, targetId, targetPath);
  const reply = await sendCommandAwait(entry.port, message, caller);
  return { reply, entry };
}

export async function talkToChief(
  fleet: Fleet,
  caller: CallerIdentity,
  query: string,
  message: string,
): Promise<TalkResult> {
  const selfId = caller.projectId ?? "";
  // Advisor agents — always running (managed by the app), connect directly.
  const advisor = resolveAdvisor(query);
  if (advisor) {
    // Fix 82: advisor self-call is forbidden. Previously Finance 2nd session ->
    // Finance 1st session (a self-call) happened because caller.kind was
    // hardcoded "sef" (Fix tools.ts). Now caller.kind="advisor" and
    // caller.advisorKey are set; reject if there is a match.
    if (caller.kind === "advisor" && caller.advisorKey === advisor.key) {
      return {
        ok: false,
        text:
          `SELF-CALL FORBIDDEN: You are already "${advisor.name}" advisor yourself. ` +
          `Answer this DIRECTLY — a talk_to_chief("${advisor.key}") call ` +
          `would loop back to yourself. If it is within your expertise, answer the user ` +
          `with your own knowledge; if outside your area, call a DIFFERENT relevant advisor (e.g. another key).`,
        hedef: advisor.name,
        isAdvisor: true,
        errorCode: "advisor_self",
      };
    }
    let retried = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await callAdvisorOnce(caller, advisor.key, advisor.port, message);
        return {
          ok: true,
          text: r.text,
          cost: r.cost,
          hedef: advisor.name,
          isAdvisor: true,
          retried,
        };
      } catch (e) {
        const code = classifyError(e);
        if (attempt === 0 && isRetriable(code)) {
          retried = true;
          // wait 2sn for throttle; 500ms for the others.
          await delay(code === "throttle" ? 2000 : 500);
          continue;
        }
        return {
          ok: false,
          text: `[${code}] could not reach agent ${advisor.name}: ${(e as Error).message}`,
          hedef: advisor.name,
          isAdvisor: true,
          errorCode: code,
          retried,
        };
      }
    }
    // unreachable
    return { ok: false, text: "communication error", hedef: advisor.name, isAdvisor: true };
  }

  const target = resolveProject(query);
  if (!target)
    return {
      ok: false,
      text: `[project_404] Project not found: ${query}`,
      hedef: query,
      errorCode: "project_404",
    };
  if (target.id === selfId) {
    // Fix 48: an explanatory message — so the chief understands the "self talk"
    // error and changes strategy (answers itself) instead of retrying. The old
    // "You cannot talk to your own project" was too short and the chief sometimes
    // said retry.
    return {
      ok: false,
      text:
        `SELF-CALL FORBIDDEN: You are already the chief of the "${target.name}" project. ` +
        `Questions/tasks about this project come to YOU — answer yourself. ` +
        `The source code is in your cwd; inspect it with Glob/Read if needed and answer directly. ` +
        `Do NOT repeat talk_to_chief.`,
      hedef: target.name,
      errorCode: "project_self",
    };
  }
  let retried = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { reply } = await callProjectOnce(fleet, caller, target.id, target.path, message);
      return { ok: true, text: reply.text, cost: reply.cost, hedef: target.name, retried };
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      // Target orchestrator could not be started -> spawn_fail
      const code: CrossError = /Target orchestrator could not be started/i.test(msg)
        ? "spawn_fail"
        : classifyError(e);
      if (attempt === 0 && isRetriable(code)) {
        retried = true;
        await delay(code === "throttle" ? 2000 : 500);
        continue;
      }
      return {
        ok: false,
        text: `[${code}] ${target.name}: ${msg}`,
        hedef: target.name,
        errorCode: code,
        retried,
      };
    }
  }
  return { ok: false, text: "communication error", hedef: target.name };
}

export const MIMAR_PORT = 4316;

// Fix 55: fetch the target agent's chat history on demand. Sends WS
// chat_history_iste, waits for chat_history_yanit. sessionId optional (all
// sessions if absent). limit optional (all entries if absent).
export async function fetchChatHistory(
  port: number,
  opts: { sessionId?: string; limit?: number } = {},
): Promise<{ ok: boolean; sonuc?: unknown; hata?: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    let done = false;
    const reqId = `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const finish = (r: { ok: boolean; sonuc?: unknown; hata?: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, hata: "Chat history query timed out (15sn)" }), 15_000);
    ws.on("open", () => {
      ws.send(JSON.stringify({
        kind: "chat_history_iste",
        reqId,
        sessionIdQ: opts.sessionId,
        limit: opts.limit,
      }));
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { kind?: string; reqId?: string; ok?: boolean; sonuc?: unknown; hata?: string };
        if (msg.kind === "chat_history_yanit" && msg.reqId === reqId) {
          finish({ ok: !!msg.ok, sonuc: msg.sonuc, hata: msg.hata });
        }
      } catch {
        /* ignore */
      }
    });
    ws.on("error", (e) => finish({ ok: false, hata: (e as Error).message }));
    ws.on("close", () => finish({ ok: false, hata: "WS closed" }));
  });
}

// Architect -> target agent: a controlled restart request. Opens WS, sends
// restart_iste, waits for the restart_kabul ack (confirms the target was
// reached), then closes. The target self-exits within ~1.5sn and comes back up
// via the supervisor child. If the ack does not arrive within 8sn, timeout
// (target busy/unreachable).
export async function sendRestartRequest(
  port: number,
  opts: { not?: string; devamGorevi?: string } = {},
): Promise<{ ok: boolean; hata?: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    let done = false;
    const finish = (r: { ok: boolean; hata?: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve(r);
    };
    const timer = setTimeout(
      () => finish({ ok: false, hata: "restart ack timed out (8sn) — target unreachable/busy" }),
      8000,
    );
    ws.on("open", () => {
      try {
        ws.send(JSON.stringify({
          kind: "restart_iste",
          restartNot: opts.not,
          restartDevam: opts.devamGorevi,
        }));
      } catch (e) {
        finish({ ok: false, hata: (e as Error).message });
      }
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { kind?: string };
        if (msg.kind === "restart_kabul") finish({ ok: true });
      } catch {
        /* ignore */
      }
    });
    ws.on("error", (e) => finish({ ok: false, hata: (e as Error).message }));
    // if close arrives before the ack it is an error; after the ack finish is already done.
    ws.on("close", () => finish({ ok: false, hata: "connection closed (no ack)" }));
  });
}

// Agent name (project_id or advisor_key or 'mimar'/'global') -> port.
export async function resolveAgentPort(
  fleet: Fleet,
  agent: string,
): Promise<{ port: number; name: string } | null> {
  const q = agent.trim().toLowerCase();
  if (q === "mimar" || q === "global" || q === "__global__") {
    return { port: MIMAR_PORT, name: "Architect" };
  }
  const adv = resolveAdvisor(agent);
  if (adv) {
    await ensureAdvisorRunning(adv.key, adv.port);
    return { port: adv.port, name: adv.name };
  }
  const proj = resolveProject(agent);
  if (proj) {
    const entry = await ensureProjectRunning(fleet, proj.id, proj.path);
    return { port: entry.port, name: proj.name };
  }
  return null;
}

export async function reportToMimar(
  caller: CallerIdentity,
  message: string,
): Promise<{ ok: boolean; text: string }> {
  // Fix 54: the caller identity is automatically prepended to the message inside
  // sendCommandAwait via buildIdentityPrefix. We also add a separate header
  // outside the message — so the Architect sees an "ISSUE REPORT" badge in the UI.
  const body = `[ISSUE REPORT — forwarded by the system]\n${message}\n\nIf you find it appropriate, make the necessary fix in the system.`;
  try {
    const r = await sendCommandAwait(MIMAR_PORT, body, caller);
    return { ok: true, text: r.text };
  } catch (e) {
    return { ok: false, text: `Could not reach the Architect: ${(e as Error).message}` };
  }
}

export function projectListText(fleet: Fleet, selfId: string): string {
  const projects = listAllProjects();
  const projeBlok = projects.length
    ? projects
        .map((p) => {
          const info = readProjectInfo(p.path);
          const running = fleet.get(p.id) ? "running" : "stopped";
          const self = p.id === selfId ? " (THIS PROJECT)" : "";
          return [
            `- ${p.name}${self} [${running}]`,
            `  path: ${p.path}`,
            `  purpose: ${info.aciklama || "(undefined)"}`,
            `  architecture: ${info.mimari || "(undefined)"}`,
          ].join("\n");
        })
        .join("\n\n")
    : "No registered projects.";

  const danismanBlok = ADVISORS.map(
    (a) => `- ${a.name} (key: ${a.key}) — consult via talk_to_chief.`,
  ).join("\n");

  return `PROJECTS:\n${projeBlok}\n\nADVISOR AGENTS (always reachable):\n${danismanBlok}`;
}
