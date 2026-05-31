// Stealth browser wrapper — Cloudflare/bot detection bypass icin.
// patchright: Playwright fork, CDP leak'leri (Runtime.Enable, Page.frameAttached)
// kapatir, navigator.webdriver maskeler, gercek Chrome fingerprint tasir.
// 2026'da puppeteer-extra-plugin-stealth tek basina yetmiyor; Cloudflare
// turnstile + chatgpt.com gibi sert korumalar icin patchright zorunlu.

import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "patchright";
import type { BrowserContext } from "playwright";

export interface StealthOptions {
  profileDir: string;
  headless?: boolean;
  viewport?: { width: number; height: number } | null;
  // true → pencereyi ekran disina yerlestir (gorunmez ama headful Cloudflare bypass).
  offscreen?: boolean;
}

// Persistent profile context — cookie/oturum diskte kalir, ikinci cagri
// ayni login durumunu kullanir. Patchright bot fingerprint maskeleme aktif.
export async function launchStealth(opts: StealthOptions): Promise<BrowserContext> {
  if (!existsSync(opts.profileDir)) {
    mkdirSync(opts.profileDir, { recursive: true });
  }
  // channel: "chrome" → sistem Chrome'unu kullan. Cloudflare bundled
  // Chromium fingerprint'ini taniyor; stable Chrome gercek kullanici imzasi.
  // ignoreDefaultArgs: Playwright'in eklendigi --enable-automation ve
  // --no-sandbox flag'leri Chrome adres cubuguna uyari basiyor + bot sinyali.
  const ctx = (await chromium.launchPersistentContext(opts.profileDir, {
    headless: opts.headless ?? true,
    channel: "chrome",
    viewport: opts.viewport === null ? null : opts.viewport ?? { width: 1280, height: 900 },
    ignoreDefaultArgs: ["--enable-automation", "--no-sandbox"],
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process,AutomationControlled",
      "--no-default-browser-check",
      "--no-first-run",
      "--lang=tr-TR",
      ...(opts.offscreen
        ? ["--window-position=-3200,-3200", "--window-size=1280,900"]
        : []),
    ],
    // userAgent verme — patchright kendi gercekci UA'sini kullansin.
  })) as unknown as BrowserContext;
  return ctx;
}
