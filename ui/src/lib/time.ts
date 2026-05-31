// All date/time formats follow the user's system time.
// Usage: import { fmtDateTime, fmtTime, fmtDate } from "$lib/time";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const LOCALE = "tr-TR";

// DD.MM.YYYY HH:mm — 24 hour
export function fmtDateTime(ts: number): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(new Date(ts)).replace(",", "");
}

// HH:mm — 24 hour
export function fmtTime(ts: number, opts?: { seconds?: boolean }): string {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    second: opts?.seconds ? "2-digit" : undefined,
    hour12: false,
    timeZone: TZ,
  }).format(new Date(ts));
}

// DD MMM — short date (example: "24 May")
export function fmtDate(ts: number, opts?: { withTime?: boolean }): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "short",
    hour: opts?.withTime ? "2-digit" : undefined,
    minute: opts?.withTime ? "2-digit" : undefined,
    hour12: false,
    timeZone: TZ,
  }).format(new Date(ts));
}
