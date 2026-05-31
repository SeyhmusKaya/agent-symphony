// Sunucu tarafi tarih/saat formatlari — sistem saatine gore.
// UI tarafindaki ui/src/lib/time.ts ile esdeger.

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const LOCALE = "tr-TR";

// DD.MM.YYYY HH:mm
export function fmtDateTimeTr(ts: number): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(new Date(ts));
}

// DD.MM.YYYY
export function fmtDateTr(ts: number): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TZ,
  }).format(new Date(ts));
}

// HH:mm
export function fmtTimeTr(ts: number): string {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(new Date(ts));
}
