// Pure helpers for ProjectScreen.svelte — formatting of numbers/time, expert
// status label/tone constants. Shared by sub-components.

import type { Attachment } from "$lib/store.svelte";

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function fmtElapsedShort(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const STATUS_LABEL: Record<string, string> = {
  bos: "Idle",
  calisiyor: "Running",
  hata: "Error",
};

export function statusTone(s: string): "warn" | "danger" | "neutral" {
  if (s === "calisiyor") return "warn"; // calisiyor → orange/amber
  if (s === "hata") return "danger";
  return "neutral";
}

export function readFile(f: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const isImg = f.type.startsWith("image/");
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const res = String(reader.result);
      if (isImg) {
        resolve({
          ad: f.name,
          tur: "resim",
          mediaType: f.type,
          veri: res.includes(",") ? res.split(",")[1] : res,
        });
      } else {
        resolve({ ad: f.name, tur: "dosya", veri: res });
      }
    };
    if (isImg) reader.readAsDataURL(f);
    else reader.readAsText(f);
  });
}
