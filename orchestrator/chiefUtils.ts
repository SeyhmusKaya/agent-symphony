// Pure helpers for main.ts — transient error detection, text formatting,
// half-plan patterns. Does not depend on any orchestrator state.

export const sleep = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

// Is the chief reply a transient error? True only if the SDK/HTTP error format
// matches. Random words like "429" / "rate limit" within the reply text should
// not produce false positives (Fix 51).
export function isTransient(text: string): boolean {
  const t = text.toLowerCase();
  const errorPatterns = [
    /api\s+error:?\s*4\d\d/i,           // "API Error: 429"
    /api\s+error:?\s*5\d\d/i,           // "API Error: 500"
    /status\s+code\s+4\d\d/i,
    /status\s+code\s+5\d\d/i,
    /\bhttp\s+4\d\d\b/i,
    /\bhttp\s+5\d\d\b/i,
    /\b429\s+too\s+many/i,
    /\b500\s+internal/i,
    /\b529\s+overloaded/i,
    /\boverloaded_error\b/i,
    // Anthropic overload warning — contains no number, a specific phrase ("not
    // your usage limit"). This is a temporary server-side throttle; should retry.
    /temporarily\s+limiting\s+requests/i,
    /server\s+is\s+temporarily/i,
    /\brate_limit_error\b/i,
    /\bconcurrent\s+request\s+limit/i,
    /\bquota\s+exceeded\b/i,
    // Gzip/deflate decode error (corrupt chunk from the network) — transient.
    /\bzliberror\b/i,
    /econnrefused/i,
    /connectionrefused/i,
    /unable\s+to\s+connect\s+to\s+api/i,
    /fetch\s+failed/i,
    /socket\s+hang\s+up/i,
    /no\s+conversation\s+found\s+with\s+session\s+id/i,
  ];
  for (const re of errorPatterns) if (re.test(t)) return true;
  return false;
}

export function kisalt(s: string, n = 280): string {
  s = s.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// M4: the turn's 60-character summary intent — the first meaningful sentence of the chief's reply.
export function extractNarrative(reply: string): string {
  if (!reply) return "";
  const lines = reply
    .split(/\n+/)
    .map((l) => l.replace(/^[#\-*>\s\d.]+/, "").trim())
    .filter((l) => l.length > 0);
  if (!lines.length) return "";
  const firstSentence = lines[0].split(/(?<=[.!?])\s/)[0] ?? lines[0];
  const cleaned = firstSentence.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 60) return cleaned;
  return cleaned.slice(0, 57) + "...";
}

// Half-plan detection: true if the chief closes the turn with patterns like
// "now I will do this" / "I am continuing" without finishing the actual plan.
// For automatic CONTINUE injection.
const HALF_PLAN_PATTERNS = [
  /\bşimdi\s+(şu|şunu|onu|bunu)\s+\w+(ec[eğ]|ac[ağ])\w+/i,
  /\bdevam\s+ediyor(um|uz)\b[\s\.\!]*$/i,
  /\bsıradaki\s+adım[aıie]?\s+(geç|geçiyor|olacak)/i,
  /\b(şu|şunu)\s+yapacağım\b/i,
  /\b\w+i\s+yapacağım\.\s*$/i,
  /\bdevam\s+edeceğim\b[\s\.\!]*$/i,
  /\bbir\s+sonraki\s+(adım|aşama|iş)\b/i,
];

// Explicit completion signal — half-plan is FALSE if the chief clearly
// completed the turn by saying "ready/done/waiting".
const COMPLETION_PATTERNS = [
  /\b(hazır(ım)?|bekliyorum|bitti|tamamlandı|tamamdir|tamam)\b[\s\.\!]*$/i,
  /\b(sıradaki|yeni)\s+(prompt|gorev|iş|adım)\s+icin\s+hazır/i,
  /\bbir\s+sonraki\s+prompt(?:un|a)?\s+(?:icin\s+)?hazır/i,
];

export function detectHalfPlan(
  reply: string,
  orphanCount: number,
  gotResult: boolean,
): boolean {
  if (!gotResult) return false; // A result error is already logged separately.
  if (orphanCount > 0) return true; // Orphan tool = half-done.
  const tail = reply.trim().slice(-300);
  if (COMPLETION_PATTERNS.some((p) => p.test(tail))) return false;
  return HALF_PLAN_PATTERNS.some((p) => p.test(tail));
}
