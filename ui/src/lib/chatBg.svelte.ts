// Chat background color — persistent across all sessions/agents, in localStorage.
const STORAGE_KEY = "arc:chat-bg";
const DEFAULT = "#fbfbf9";

function readStored(): string {
  if (typeof window === "undefined") return DEFAULT;
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function applyToRoot(color: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--arc-chat-bg", color);
}

export const chatBg = $state({ color: readStored() });

export function setChatBg(color: string): void {
  chatBg.color = color;
  applyToRoot(color);
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, color);
  } catch {
    /* ignore */
  }
}

if (typeof window !== "undefined") {
  applyToRoot(chatBg.color);
}
