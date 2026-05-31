// Fix 137: a Promise-based in-app confirmation modal that does NOT depend on the
// Tauri dialog plugin (plugin:dialog|confirm).
//
// Reason: the browser global `confirm()` maps to the plugin:dialog|confirm IPC
// call in the Tauri v2 webview. Two problems:
//   (1) If the ACL/window match does not hold, "Command plugin:dialog|confirm not
//       allowed by ACL" REJECT -> unhandled rejection -> the whole UI bricks (app.html).
//   (2) The Tauri override is ASYNC (returns a Promise) but the code reads it as a
//       SYNC bool with `if (!confirm(...))` and always sees truthy -> broken confirm logic.
// Solution: entirely our own modal. No ACL, no sync-Promise bug, design-consistent
// (arc CSS variables). Use `confirmDialog()` instead of `confirm()` / Tauri `ask()`.

export interface ConfirmOpts {
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // red confirm button for destructive actions like delete/destroy
  title?: string;
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const css = `
.arc-confirm-overlay{position:fixed;inset:0;z-index:2147483646;display:flex;
 align-items:center;justify-content:center;background:rgba(15,23,42,.42);
 backdrop-filter:blur(2px);animation:arc-cf-fade .12s ease}
.arc-confirm-card{background:var(--arc-surface,#fff);border:1px solid var(--arc-border,#e2e8f0);
 border-radius:var(--arc-r,12px);box-shadow:0 18px 50px rgba(0,0,0,.28);
 max-width:380px;width:calc(100% - 48px);padding:20px 20px 16px;
 animation:arc-cf-pop .14s cubic-bezier(.16,.84,.44,1)}
.arc-confirm-title{font-size:14px;font-weight:700;color:var(--arc-text,#0f172a);margin:0 0 6px}
.arc-confirm-msg{font-size:13px;line-height:1.55;color:var(--arc-text-soft,#475569);
 margin:0 0 18px;white-space:pre-wrap;word-break:break-word}
.arc-confirm-row{display:flex;gap:9px;justify-content:flex-end}
.arc-confirm-btn{font:inherit;font-size:12.5px;font-weight:600;padding:8px 16px;
 border-radius:var(--arc-r-pill,999px);cursor:pointer;border:1px solid var(--arc-border,#e2e8f0);
 transition:transform .12s,box-shadow .12s,background .12s,border-color .12s}
.arc-confirm-btn:hover{transform:translateY(-1px)}
.arc-confirm-cancel{background:var(--arc-surface-2,#f1f5f9);color:var(--arc-text-soft,#475569)}
.arc-confirm-cancel:hover{border-color:var(--arc-text-faint,#94a3b8)}
.arc-confirm-ok{background:var(--arc-primary,#0f766e);color:#fff;border-color:transparent}
.arc-confirm-ok:hover{box-shadow:0 4px 14px color-mix(in srgb,var(--arc-primary,#0f766e) 40%,transparent)}
.arc-confirm-ok.danger{background:var(--arc-danger,#dc2626)}
.arc-confirm-ok.danger:hover{box-shadow:0 4px 14px color-mix(in srgb,var(--arc-danger,#dc2626) 40%,transparent)}
@keyframes arc-cf-fade{from{opacity:0}}
@keyframes arc-cf-pop{from{opacity:0;transform:translateY(8px) scale(.98)}}`;
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}

export function confirmDialog(message: string, opts: ConfirmOpts = {}): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  injectStyle();
  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "arc-confirm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const card = document.createElement("div");
    card.className = "arc-confirm-card";

    if (opts.title) {
      const t = document.createElement("div");
      t.className = "arc-confirm-title";
      t.textContent = opts.title;
      card.appendChild(t);
    }

    const msg = document.createElement("div");
    msg.className = "arc-confirm-msg";
    msg.textContent = message;
    card.appendChild(msg);

    const row = document.createElement("div");
    row.className = "arc-confirm-row";

    const cancel = document.createElement("button");
    cancel.className = "arc-confirm-btn arc-confirm-cancel";
    cancel.textContent = opts.cancelLabel ?? "Cancel";

    const ok = document.createElement("button");
    ok.className = "arc-confirm-btn arc-confirm-ok" + (opts.danger ? " danger" : "");
    ok.textContent = opts.okLabel ?? "Confirm";

    row.appendChild(cancel);
    row.appendChild(ok);
    card.appendChild(row);
    overlay.appendChild(card);

    let done = false;
    const cleanup = (val: boolean): void => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(val);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { e.preventDefault(); cleanup(false); }
      else if (e.key === "Enter") { e.preventDefault(); cleanup(true); }
    };

    cancel.onclick = () => cleanup(false);
    ok.onclick = () => cleanup(true);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
    document.addEventListener("keydown", onKey, true);

    document.body.appendChild(overlay);
    ok.focus();
  });
}
