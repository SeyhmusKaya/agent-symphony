/* Message box draft — survives chat switches and app restarts. */
export function loadDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* localStorage unavailable — ignore */
  }
}

/* Attachments (image/file) — held in a module-level Map.
   Memory is used instead of sessionStorage; no size limit, not JSON
   serialized. State is preserved even when components are destroyed/recreated
   across view/tab switches (as long as the module singleton stays alive). */
const eklerCache = new Map<string, unknown[]>();

export function loadEkler(key: string): unknown[] {
  return eklerCache.get(key) ?? [];
}

export function saveEkler(key: string, ekler: unknown[]): void {
  if (ekler.length) {
    eklerCache.set(key, ekler);
  } else {
    eklerCache.delete(key);
  }
}
