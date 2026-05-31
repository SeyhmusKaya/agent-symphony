// ui/src/lib/store/pending.ts — Fix 101 localStorage persist.
// While WS is down, commands the user sends go to the pending queue; if the
// window is closed the in-memory queue is lost. A backup is written to
// localStorage and restored on connect. ProjectSession uses these helpers.

const STORAGE_PREFIX = "architect_pending_";

export function storageKeyPending(url: string): string {
  return `${STORAGE_PREFIX}${url || "noport"}`;
}

export function savePending(url: string, pending: string[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    const key = storageKeyPending(url);
    if (pending.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(pending));
    }
  } catch {
    /* ignore */
  }
}

export function loadPending(url: string): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(storageKeyPending(url));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
      return arr as string[];
    }
  } catch {
    /* ignore */
  }
  return [];
}
