// ui/src/lib/notes/helpers.ts — pure functions for NotesScreen.
// escapeHtml + extractImagesFromHtml + fileToBase64 + preview + fmtTarih
// (used by both NotesScreen and the upcoming NoteCard component).

import { fmtDate } from "$lib/time";
import type { Note } from "$lib/notes.svelte";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Extract all <img src> values from the BlockEditor HTML — for the card
// thumbnail + merge during edit. Duplicate-safe; order is preserved.
export function extractImagesFromHtml(html: string): string[] {
  if (!html) return [];
  const out: string[] = [];
  const re = /<img\b[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

// File → base64 data URL. Used by the quick-add composer and modal paste handlers.
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// Single-line preview text for the card — collapses extra whitespace.
export function preview(n: Note): string {
  return (n.icerik || "").replace(/\s+/g, " ").trim();
}

// Creation time displayed at the bottom of the card.
export function fmtTarih(ts: number): string {
  return fmtDate(ts, { withTime: true });
}

// Split plain text without HTML into paragraphs and produce BlockEditor-ready
// HTML — for opening old notes (without bodyHtml) in the modal.
export function plainTextToBlockHtml(plain: string): string {
  if (!plain || !plain.trim()) return "";
  return plain
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
