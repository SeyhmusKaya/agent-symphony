// Single notification channel. ALL points in the UI that emit notifications
// must pass through here; this way there is no duplicate notify, title/format
// is consistent, and the permission cache lives in one place. Backend tools
// (git_commit, restart_self, rebuild_ui) NEVER emit notifications directly —
// every notification signal arrives here from the sef_tamamen_idle or
// ajan_soru event.

let permGranted: boolean | null = null;
let permPending: Promise<boolean> | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permGranted !== null) return permGranted;
  if (permPending) return permPending;
  permPending = (async () => {
    try {
      const { isPermissionGranted, requestPermission } = await import(
        "@tauri-apps/plugin-notification"
      );
      let g = await isPermissionGranted();
      if (!g) g = (await requestPermission()) === "granted";
      permGranted = g;
      return g;
    } catch {
      permGranted = false;
      return false;
    } finally {
      permPending = null;
    }
  })();
  return permPending;
}

function kisalt(s: string, n = 120): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function formatElapsed(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

// Click routing — if onAction fires, +page reads this and switches to the
// relevant view. Additionally, when we catch window focus we also use pending
// if present (toast clicks on Windows do not always drive onAction).
let pendingNavAgent: string | null = null;
const onAgentNavCallbacks: Array<(key: string) => void> = [];

export function onAgentNotificationClick(cb: (agentKey: string) => void): () => void {
  onAgentNavCallbacks.push(cb);
  return () => {
    const i = onAgentNavCallbacks.indexOf(cb);
    if (i >= 0) onAgentNavCallbacks.splice(i, 1);
  };
}

function fireAgentNav(key: string): void {
  pendingNavAgent = null;
  for (const cb of onAgentNavCallbacks) {
    try { cb(key); } catch { /* ignore */ }
  }
}

export function takePendingAgentNav(): string | null {
  const k = pendingNavAgent;
  pendingNavAgent = null;
  return k;
}

let actionListenerRegistered = false;
async function ensureActionListener(): Promise<void> {
  if (actionListenerRegistered) return;
  actionListenerRegistered = true;
  try {
    const { onAction } = await import("@tauri-apps/plugin-notification");
    await onAction((n) => {
      const ex = (n as { extra?: Record<string, unknown> }).extra;
      const ak = ex && typeof ex.agentKey === "string" ? (ex.agentKey as string) : null;
      if (ak) fireAgentNav(ak);
    });
  } catch {
    /* plugin not supported — the pendingNavAgent fallback is used */
  }
}

async function send(
  title: string,
  body: string,
  agentKey?: string,
): Promise<void> {
  if (!(await ensurePermission())) return;
  // P1.33 fix: pendingNavAgent is set ONLY when the window is NOT FOCUSED.
  // Old behavior: notifyAgentIdle called with forceShow:true (sef_tamamen_idle)
  // set pendingNav even while the window was focused — when the user was on the
  // Architect tab and the focus event fired again, the UI forcibly jumped to the
  // SEO advisor. Toast click fallback: if the user clicks the toast, the window
  // FIRST blurs then focuses — so a blur must occur between set/get in order to
  // pick up pendingNav on focus while it is NOT set.
  if (agentKey) {
    const focused = typeof document !== "undefined"
      && document.visibilityState === "visible"
      && document.hasFocus();
    if (!focused) pendingNavAgent = agentKey;
  }
  // M2: If agentKey is UUID-like (project chief), send it as projectId —
  // the Rust side finds the logo file from projeler.json and shows it via
  // Toast::icon. Advisor keys are in "__advisor_xxx__" format; not a UUID → no
  // icon, the default app icon (AUMID IconUri) is shown.
  const isProjectId = !!agentKey &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentKey);
  const projectId = isProjectId ? agentKey : undefined;
  try {
    // tauri-plugin-notification does not set AUMID in target/release → the
    // toast shows "Windows PowerShell". Our notify_user command on the Rust side
    // calls Toast::new(AUMID) directly via tauri-winrt-notification — the title
    // resolves to "Agent Symphony".
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("notify_user", { title, body, projectId });
  } catch {
    // Fallback: the old plugin path (dev build, etc).
    try {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      void ensureActionListener();
      const opts: { title: string; body: string; extra?: Record<string, unknown> } = { title, body };
      if (agentKey) opts.extra = { agentKey };
      sendNotification(opts);
    } catch {
      /* ignore */
    }
  }
}

// An agent type fully finished — notify the user. Fires if the window is not
// focused; otherwise silent.
// Notification design:
//   Title  → "✅ {agentName}"        (who finished is immediately clear)
//   Body   → "{last message}  ·  ⏱ {duration}  ·  📊 {in} → {out}"
export async function notifyAgentIdle(opts: {
  agentName: string;
  agentKey?: string;
  lastMessage?: string;
  elapsedMs?: number;
  liveIn?: number;
  liveOut?: number;
  forceShow?: boolean; // force regardless of focus check
}): Promise<void> {
  const focused =
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus();
  if (focused && !opts.forceShow) return;

  // Notification title: emoji + agent session name
  const title = `✅ ${opts.agentName}`;

  // Message content (truncate if long)
  const msg = kisalt(opts.lastMessage || "Task completed.", 100);

  // Compact statistic lines
  const stats: string[] = [];
  if (opts.elapsedMs && opts.elapsedMs > 0) {
    stats.push(`⏱ ${formatElapsed(opts.elapsedMs)}`);
  }
  const totalTokens = (opts.liveIn || 0) + (opts.liveOut || 0);
  if (totalTokens > 0) {
    stats.push(`📊 ${formatTokens(opts.liveIn || 0)} → ${formatTokens(opts.liveOut || 0)}`);
  }

  const body = stats.length ? `${msg}  ·  ${stats.join("  ·  ")}` : msg;
  await send(title, body, opts.agentKey);
}

// An agent is asking the user a question — fire if the window is NOT focused (PROMPT 7).
// Notification design:
//   Title  → "💬 {agentName}"        (who is asking)
//   Body   → the question content
export async function notifyAgentQuestion(opts: {
  agentName: string;
  agentKey?: string;
  question: string;
}): Promise<void> {
  const focused =
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus();
  if (focused) return;

  const title = `💬 ${opts.agentName}`;
  const body = kisalt(opts.question, 150);
  await send(title, body, opts.agentKey);
}
