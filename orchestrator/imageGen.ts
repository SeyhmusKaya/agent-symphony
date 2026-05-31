// Image generation — via Playwright over a ChatGPT Plus session.
// A browser bot route so the user can leverage their Plus subscription.
// Persistent profile: the chromium session is stored under
// appData/com.seyh.architect/chatgpt-profile; on first use a visible browser
// opens for the user to log in to chatgpt.com, then every call reuses that session.

import { createHmac } from "node:crypto";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { appDataDir } from "./fleet.js";
import { launchStealth } from "./stealth.js";
import { Vault } from "./vault.js";

// ── TOTP (RFC 6238) — generates a 6-digit code from the base32 secret in the vault ──────
function base32Decode(s: string): Buffer {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const str = s.toUpperCase().replace(/=+$/, "");
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const c of str) {
    const idx = alpha.indexOf(c);
    if (idx === -1) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((val >> bits) & 0xff); }
  }
  return Buffer.from(out);
}

function generateTOTP(secret: string): string {
  const key = base32Decode(secret);
  const t = BigInt(Math.floor(Date.now() / 1000 / 30));
  const msg = Buffer.alloc(8);
  msg.writeBigInt64BE(t);
  const hmac = createHmac("sha1", key).update(msg).digest();
  const offset = hmac[19] & 0xf;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      (hmac[offset + 1] << 16) |
      (hmac[offset + 2] << 8) |
      hmac[offset + 3]) %
    1_000_000;
  return String(code).padStart(6, "0");
}

// ── Automatic login — Google OAuth flow using email/password/2fa from the vault ────
// For ChatGPT @gmail accounts: chatgpt.com/auth/login → Google OAuth flow.
async function autoLogin(page: Page): Promise<void> {
  const vault = new Vault();
  const email = vault.get("chatgpt_email");
  const password = vault.get("chatgpt_password");
  const totpSecret = vault.get("chatgpt_2fa_secret");

  if (!email || !password) {
    throw new Error(
      "image_gen_failed: chatgpt_email or chatgpt_password is missing in the Vault.",
    );
  }

  // ── STEP 1: ChatGPT login page — click "Continue with Google" ────────────
  // Most reliable path for Gmail accounts: the Google OAuth button directly.
  await page.goto(
    "https://chatgpt.com/auth/login?callbackUrl=https%3A%2F%2Fchatgpt.com",
    { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS },
  );
  const googleBtn = page.locator(
    'button:has-text("Google ile devam et"), button:has-text("Continue with Google")',
  ).first();
  await googleBtn.waitFor({ timeout: 10_000 });
  await googleBtn.click();

  // ── STEP 2: Google OAuth identifier page ──────────────────────────────
  // accounts.google.com opens via a Google popup or redirect.
  await page.waitForURL(/accounts\.google\.com/, { timeout: 15_000 });

  // Google identifier (email) page — with login_hint the email is sometimes
  // prefilled, sometimes empty. If not filled, type the email again.
  const googleEmailInput = page.locator('input#identifierId').first();
  await googleEmailInput.waitFor({ timeout: 10_000 });
  const currentVal = await googleEmailInput.inputValue().catch(() => "");
  if (!currentVal) {
    await googleEmailInput.click();
    await googleEmailInput.type(email, { delay: 40 });
  }
  await page.locator('button:has-text("Sonraki"), button:has-text("Next")').first().click();

  // ── STEP 3: Google password page ─────────────────────────────────────────
  const googlePassInput = page.locator('input[name="Passwd"], input[type="password"]').first();
  await googlePassInput.waitFor({ timeout: 15_000 });
  await googlePassInput.click();
  await googlePassInput.type(password, { delay: 40 });
  // Google TR UI: "Sonraki" | EN: "Next" | ES: "Siguiente"
  await page.locator('button:has-text("Sonraki"), button:has-text("Next"), button:has-text("İleri")').first().click();

  // ── STEP 4: 2FA (Google Authenticator / TOTP) — not always shown ─────────
  try {
    // Google 2FA: "2-step verification" → TOTP code input field
    const otpInput = page.locator(
      'input[name="totpPin"], input[autocomplete="one-time-code"], input[inputmode="numeric"]',
    ).first();
    await otpInput.waitFor({ timeout: 10_000 });
    if (totpSecret) {
      const code = generateTOTP(totpSecret);
      await otpInput.click();
      await otpInput.type(code, { delay: 30 });
      await page.locator('button:has-text("İleri"), button:has-text("Next"), button[type="submit"]').first().click();
    }
  } catch {
    // 2FA was not requested — continue
  }

  // ── STEP 5: Google consent/dialog screens ─────────────────────────────────
  // "Stay signed in", "Continue", "Allow", etc.
  for (const text of [
    "Devam", "Continue", "Izin ver", "Allow",
    "Oturumumu açık tut", "Stay signed in",
  ]) {
    try {
      const btn = page.locator(`button:has-text("${text}")`).first();
      if (await btn.isVisible({ timeout: 3_000 })) await btn.click();
    } catch { /* ignore */ }
  }

  // ── STEP 6: Return to ChatGPT, wait until the prompt textarea appears ───────
  await page.waitForURL(/chatgpt\.com/, { timeout: 20_000 }).catch(() => {});
  await page.waitForSelector(
    'textarea#prompt-textarea, div#prompt-textarea, [data-testid="prompt-textarea"]',
    { timeout: 30_000 },
  );
}

export interface GeneratedImage {
  mediaType: string;
  base64: string;
  sourceUrl: string;
}

export interface GenerateImageOptions {
  width?: number;
  height?: number;
  seed?: number;
}

const PROFILE_DIR = join(appDataDir(), "chatgpt-profile");
const NAV_TIMEOUT_MS = 45_000;
const GEN_TIMEOUT_MS = 180_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

let cachedCtx: BrowserContext | null = null;
let ctxBusy: Promise<void> | null = null;

// mode: "visible" (for login), "offscreen" (for automatic image generation
// — headful but the window is off-screen, Cloudflare bypass).
async function getContext(mode: "visible" | "offscreen"): Promise<BrowserContext> {
  if (cachedCtx) return cachedCtx;
  // Stealth wrapper — patchright (CDP leak fix + Cloudflare bypass).
  // In headless mode the Cloudflare turnstile appears and the textarea never
  // shows; so always headful, only the position differs.
  const ctx = await launchStealth({
    profileDir: PROFILE_DIR,
    headless: false,
    viewport: null,
    offscreen: mode === "offscreen",
  });
  cachedCtx = ctx;
  ctx.on("close", () => {
    if (cachedCtx === ctx) cachedCtx = null;
  });
  return ctx;
}

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto("https://chatgpt.com/", {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    // The login page redirects to auth.openai.com; if it stays on chatgpt.com
    // the main UI is present. Also check whether the prompt textarea exists.
    const url = page.url();
    if (url.includes("auth.openai.com") || url.includes("/login")) return false;
    await page.waitForSelector(
      'textarea#prompt-textarea, div#prompt-textarea, [data-testid="prompt-textarea"]',
      { timeout: 8000 },
    );
    return true;
  } catch {
    return false;
  }
}

// Automatic login — runs in the background with vault credentials.
// Opens a visible browser (Cloudflare bypass), closes it once login completes.
// Subsequent generateImage calls use the saved persistent profile.
export async function ensureChatGPTLogin(): Promise<{ ok: boolean; mesaj: string }> {
  // Close the existing context, open a clean visible context.
  if (cachedCtx) {
    try { await cachedCtx.close(); } catch { /* ignore */ }
    cachedCtx = null;
  }
  const ctx = await getContext("visible");
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  try {
    // Check if the session is correct — logged in with the right email?
    await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    let needLogin = true;
    try {
      await page.waitForSelector(
        'textarea#prompt-textarea, div#prompt-textarea, [data-testid="prompt-textarea"]',
        { timeout: 8000 },
      );
      // Sanity check: read the email from /api/auth/session
      await page.goto("https://chatgpt.com/api/auth/session", { timeout: 10_000 });
      const raw = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "{}");
      const session = JSON.parse(raw.trim() || "{}") as { user?: { email?: string } };
      const vault = new Vault();
      const expectedEmail = vault.get("chatgpt_email") ?? "";
      needLogin = session.user?.email?.toLowerCase() !== expectedEmail.toLowerCase();
    } catch {
      needLogin = true;
    }

    if (!needLogin) {
      return { ok: true, mesaj: "ChatGPT Plus session is already active on the correct account." };
    }

    // To log in again, first clear cookies, return to the home page
    await ctx.clearCookies();
    await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    // Automatic login with vault credentials
    await autoLogin(page);

    // Persistent profile cookies are already on disk; extra state backup.
    try {
      await ctx.storageState({ path: `${PROFILE_DIR}/storage-state.json` });
    } catch { /* ignore */ }
    return { ok: true, mesaj: "ChatGPT Plus session was logged in automatically and saved." };
  } catch (e) {
    return {
      ok: false,
      mesaj: `Login error: ${(e as Error).message}`,
    };
  } finally {
    // Close the visible context; generateImage will use the offscreen context.
    try { await ctx.close(); } catch { /* ignore */ }
    cachedCtx = null;
  }
}

export async function generateImage(
  prompt: string,
  _opts: GenerateImageOptions = {},
): Promise<GeneratedImage> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("image_gen_failed: empty prompt");

  // One call at a time — concurrent calls corrupt the same context.
  while (ctxBusy) await ctxBusy;
  let resolveBusy: () => void = () => {};
  ctxBusy = new Promise<void>((r) => (resolveBusy = r));

  try {
    const ctx = await getContext("offscreen");
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    // A FRESH chat for each image — do not accumulate previous conversation
    // state, reducing the risk of silent fail in cases like the 4096x4096 error.
    await page.goto("https://chatgpt.com/", {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });

    const loggedIn = await isLoggedIn(page);
    if (!loggedIn) {
      // No session — close the offscreen context, open visible and auto-login,
      // then continue with offscreen.
      try { await ctx.close(); } catch { /* ignore */ }
      cachedCtx = null;
      const loginResult = await ensureChatGPTLogin();
      if (!loginResult.ok) {
        throw new Error(`image_gen_failed: ${loginResult.mesaj}`);
      }
      // Login successful — reacquire the offscreen context.
      const newCtx = await getContext("offscreen");
      const freshPage = newCtx.pages()[0] ?? (await newCtx.newPage());
      await freshPage.goto("https://chatgpt.com/", {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      // Rename to continue with the new context/page — but that's outside this
      // scope. Cleanest solution: a recursive call (once).
      return generateImage(prompt, _opts);
    }

    // Find the prompt textarea (may be a ContentEditable div or a textarea).
    const inputSel =
      'div#prompt-textarea, textarea#prompt-textarea, [data-testid="prompt-textarea"]';
    await page.waitForSelector(inputSel, { timeout: 10_000 });
    const input = page.locator(inputSel).first();
    await input.click();
    // Size: ChatGPT image_gen only accepts 1024x1024 / 1024x1792 / 1792x1024.
    // Even if the user writes 4k/8k, force "size 1024x1024" into the prompt,
    // otherwise silent fail (like 4096x4096). Take size from opts or the default.
    const w = Math.min(_opts.width ?? 1024, 1792);
    const h = Math.min(_opts.height ?? 1024, 1792);
    const fullPrompt =
      `Generate ONE image at ${w}x${h} resolution. ` +
      `Do not request larger sizes regardless of any "4k/8k/ultra HD" wording. ` +
      `Description: ${trimmed}`;
    await page.keyboard.type(fullPrompt, { delay: 8 });
    // Submit — Enter (Shift+Enter for a newline).
    await page.keyboard.press("Enter");

    // Wait until an <img> element appears inside the assistant's reply.
    // ChatGPT image CDNs: oaiusercontent.com (GPT-4o), files.oaiusercontent,
    // oaidalleapiprodscus (old DALL-E), sediment.azureedge, cdn.openai.com.
    // Inside the assistant message block (to not count avatar/UI icons).
    const ASSIST = '[data-message-author-role="assistant"]';
    const IMG_URL_RE = /oaiusercontent|oaidalleapi|sediment\.azureedge|cdn\.openai|files\.oaiusercontent/;
    const imgLocator = page.locator(
      `${ASSIST} img[src*="oaiusercontent"], ` +
      `${ASSIST} img[src*="oaidalleapi"], ` +
      `${ASSIST} img[src*="sediment"], ` +
      `${ASSIST} img[src*="cdn.openai"]`,
    ).last();
    try {
      await imgLocator.waitFor({ timeout: GEN_TIMEOUT_MS });
    } catch (e) {
      // Debug: append the last assistant message's text to the error message.
      let lastText = "";
      try {
        lastText = (await page.locator(ASSIST).last().innerText({ timeout: 2000 })) || "";
      } catch { /* ignore */ }
      // Maybe the img URL pattern changed — is there any img inside main?
      let anyImg = "";
      try {
        anyImg = (await page.locator(`${ASSIST} img`).first().getAttribute("src", { timeout: 1500 })) ?? "";
      } catch { /* ignore */ }
      if (anyImg && !IMG_URL_RE.test(anyImg)) {
        throw new Error(
          `image_gen_failed: unknown img src pattern: ${anyImg.slice(0, 200)}`,
        );
      }
      throw new Error(
        `image_gen_failed: no image appeared. Last assistant: ${lastText.slice(0, 400)}`,
      );
    }

    const src = await imgLocator.getAttribute("src");
    if (!src) throw new Error("image_gen_failed: img src is empty");

    // Download the image — fetch from the page context (cookie auth may be needed).
    const result = await page.evaluate(async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const buf = await r.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return {
        base64: btoa(bin),
        mediaType: r.headers.get("content-type") ?? "image/png",
      };
    }, src);

    return {
      mediaType: result.mediaType,
      base64: result.base64,
      sourceUrl: src,
    };
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith("image_gen_failed:")) throw e;
    throw new Error(`image_gen_failed: ${m}`);
  } finally {
    resolveBusy();
    ctxBusy = null;
  }
}

// Clean up the context when the process exits.
process.on("beforeExit", () => {
  if (cachedCtx) {
    cachedCtx.close().catch(() => {});
    cachedCtx = null;
  }
});
