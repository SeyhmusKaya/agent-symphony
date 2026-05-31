// orchestrator/notifications.ts — F3 (Otonom 3-Gun Modu) yardimcisi.
//
// Cok-kanalli bildirim sevki. AutonomousManager "is bitti / is dustu" gibi
// onemli olaylari buradan UI + webhook + (opsiyonel) email kanallarina yayar.
//
// Kanallar:
//  - OS / UI: emit("autonomous_notification", {...}) -> UI ws broadcast,
//    Tauri notification orada tetiklenir. (Backend Tauri komutuna direkt
//    erisemez; WS uzerinden UI'a sinyal atip UI tarafi os toast'ini gosterir.)
//  - Webhook: NOTIFY_WEBHOOK_URL env'i tanimliysa built-in fetch ile POST.
//    Slack/Discord/Telegram uyumlu generic payload.
//  - Email: SMTP_HOST + SMTP_PORT env'leri tanimliysa stub yol. Su anda
//    feature-gated: gercek SMTP konusmasi TODO — kullanici SMTP_HOST set
//    edince burada implement edilir. nodemailer dependency YOK (yasak).
//
// Config: ~/.architect/notify.json — { os: bool, webhook: bool, email: bool }.
// Dosya yoksa safe-fallback (sadece OS aktif).
//
// Anti-bagimlilik notu: nodemailer/axios eklemiyoruz. fetch builtin (Node 20+).

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

export type NotificationKind =
  | "autonomous_job_started"
  | "autonomous_job_completed"
  | "autonomous_job_failed"
  | "autonomous_job_paused"
  | "autonomous_job_cancelled"
  | "autonomous_checkpoint";

export interface NotificationPayload {
  kind: NotificationKind;
  title: string;
  body: string;
  agent?: string;
  // Ek metadata — webhook payload icinde JSON.stringify edilir.
  meta?: Record<string, unknown>;
}

export interface NotifyConfig {
  os: boolean;
  webhook: boolean;
  email: boolean;
}

// Backend cagri imzasi.
export type EmitFn = (kind: string, payload: Record<string, unknown>) => void;

const DEFAULT_CFG: NotifyConfig = { os: true, webhook: false, email: false };

function configPath(appDataDir: string): string {
  return join(appDataDir, "notify.json");
}

export function loadNotifyConfig(appDataDir: string): NotifyConfig {
  try {
    const p = configPath(appDataDir);
    if (!existsSync(p)) return { ...DEFAULT_CFG };
    const raw = readFileSync(p, "utf8").trim();
    if (!raw) return { ...DEFAULT_CFG };
    const parsed = JSON.parse(raw) as Partial<NotifyConfig>;
    return {
      os: parsed.os ?? DEFAULT_CFG.os,
      webhook: parsed.webhook ?? DEFAULT_CFG.webhook,
      email: parsed.email ?? DEFAULT_CFG.email,
    };
  } catch {
    return { ...DEFAULT_CFG };
  }
}

export function saveNotifyConfig(appDataDir: string, cfg: NotifyConfig): void {
  try {
    const p = configPath(appDataDir);
    const dir = dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(cfg, null, 2), "utf8");
  } catch {
    /* yoksay — disk hatasi notify'i bozmasin */
  }
}

export interface NotifierOpts {
  appDataDir: string;
  emit: EmitFn;
  // Backend logger — webhook hatasi sessizce yoksayilmaz, kullanici loglara baksin.
  logger?: { info: (m: string, x?: Record<string, unknown>) => void; warn: (m: string, x?: Record<string, unknown>) => void };
}

export class Notifier {
  private appDataDir: string;
  private emit: EmitFn;
  private logger?: NotifierOpts["logger"];

  constructor(opts: NotifierOpts) {
    this.appDataDir = opts.appDataDir;
    this.emit = opts.emit;
    this.logger = opts.logger;
  }

  // Tek giris noktasi — tum kanallari sirayla degerlendirir, hicbiri throw etmez.
  async send(payload: NotificationPayload): Promise<void> {
    const cfg = loadNotifyConfig(this.appDataDir);

    // 1) OS / UI — emit eventbus, server.ts broadcast'lar.
    if (cfg.os) {
      try {
        this.emit("autonomous_notification", {
          kind: payload.kind,
          title: payload.title,
          body: payload.body,
          agent: payload.agent ?? null,
          meta: payload.meta ?? {},
          ts: Date.now(),
        });
      } catch (e) {
        this.logger?.warn("notify_os_emit_hata", { hata: (e as Error).message });
      }
    }

    // 2) Webhook — built-in fetch, dependency yok.
    if (cfg.webhook) {
      await this.sendWebhook(payload).catch((e) => {
        this.logger?.warn("notify_webhook_hata", { hata: (e as Error).message });
      });
    }

    // 3) Email — feature-gated. SMTP_HOST yoksa hicbir sey yapma.
    // (Implement when SMTP_HOST env is set — node:net + tls ile raw SMTP konusmasi.)
    if (cfg.email && process.env.SMTP_HOST) {
      await this.sendEmail(payload).catch((e) => {
        this.logger?.warn("notify_email_hata", { hata: (e as Error).message });
      });
    }
  }

  // Webhook gonderimi — Slack/Discord/Telegram'in hepsiyle uyumlu generic body.
  // NOTIFY_WEBHOOK_URL set degilse atla.
  private async sendWebhook(payload: NotificationPayload): Promise<void> {
    const url = process.env.NOTIFY_WEBHOOK_URL;
    if (!url) return;
    // Slack-style: { text } / Discord-style: { content } / generic: { title, body }
    // Hepsi ayni body'de — alici hangisini okuyacagina kendi karar verir.
    const text = `[${payload.title}] ${payload.body}`;
    const body = JSON.stringify({
      // Slack
      text,
      // Discord
      content: text,
      // Generic
      title: payload.title,
      body: payload.body,
      kind: payload.kind,
      agent: payload.agent ?? null,
      meta: payload.meta ?? {},
      ts: Date.now(),
    });
    // AbortSignal.timeout — built-in, 6sn icin yeterli.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      throw new Error(`webhook ${res.status} ${res.statusText}`);
    }
    this.logger?.info("notify_webhook_basari", { kind: payload.kind, status: res.status });
  }

  // Email gonderimi — TODO stub. Gercek SMTP konusmasi node:net ile yapilabilir
  // ancak ilk surumde feature-gated tutuluyor. Kullanici SMTP_HOST set edip
  // hizmete ihtiyac duydugunda burada implement edilir (HELO/MAIL FROM/RCPT TO/
  // DATA/QUIT). Mevcut surumde sadece log atilir.
  private async sendEmail(payload: NotificationPayload): Promise<void> {
    // feature gated: implement when SMTP_HOST env is set
    this.logger?.info("notify_email_stub", {
      kind: payload.kind,
      title: payload.title,
      host: process.env.SMTP_HOST,
      to: process.env.SMTP_TO ?? "(SMTP_TO yok)",
    });
  }
}
