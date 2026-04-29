import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { AppConfig } from "../config.js";
import type { AlertEventType, AlertPreference, FarcasterSubscription } from "../types.js";
import { JsonStore } from "../storage/jsonStore.js";
import { getPool } from "../storage/postgres.js";

export interface AlertInput {
  fid?: number;
  walletAddress?: string;
  type: AlertEventType;
  title: string;
  body: string;
  targetUrl?: string;
  severity?: "info" | "warning" | "critical";
  transactionHash?: string;
}

export class AlertService {
  private readonly subscriptions: JsonStore<FarcasterSubscription>;
  private readonly preferences: JsonStore<AlertPreference>;
  private readonly databaseUrl: string;
  private emailTransport?: nodemailer.Transporter;

  constructor(private readonly config: AppConfig) {
    this.subscriptions = JsonStore.forCollection<FarcasterSubscription>(config.dataDir, "farcaster-subscriptions");
    this.preferences = JsonStore.forCollection<AlertPreference>(config.dataDir, "alert-preferences");
    this.databaseUrl = config.databaseUrl;
  }

  async upsertSubscription(input: {
    fid: number;
    url: string;
    token: string;
    walletAddress?: string;
    enabled?: boolean;
  }): Promise<FarcasterSubscription> {
    const now = new Date().toISOString();
    if (this.databaseUrl) {
      const existing = await this.getSubscription(input.fid);
      const result = await getPool(this.databaseUrl).query(
        `INSERT INTO farcaster_subscriptions (
           fid, url, token, wallet_address, enabled, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (fid) DO UPDATE SET
           url = EXCLUDED.url,
           token = EXCLUDED.token,
           wallet_address = COALESCE(EXCLUDED.wallet_address, farcaster_subscriptions.wallet_address),
           enabled = EXCLUDED.enabled,
           updated_at = EXCLUDED.updated_at
         RETURNING fid, url, token, wallet_address, enabled, created_at, updated_at`,
        [
          input.fid,
          input.url,
          input.token,
          normalizeWallet(input.walletAddress ?? existing?.walletAddress) ?? null,
          input.enabled ?? true,
          now,
          now
        ]
      );
      return rowToSubscription(result.rows[0]);
    }
    const existing = await this.subscriptions.find(candidate => candidate.fid === input.fid);
    const record: FarcasterSubscription = {
      fid: input.fid,
      url: input.url,
      token: input.token,
      walletAddress: input.walletAddress ?? existing?.walletAddress,
      enabled: input.enabled ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    return this.subscriptions.upsert(record, candidate => candidate.fid === input.fid);
  }

  async setPreferences(input: AlertPreference): Promise<AlertPreference> {
    const record = { ...input, updatedAt: new Date().toISOString() };
    if (!record.fid) return this.setEmailPreferences(record);
    if (this.databaseUrl) {
      const result = await getPool(this.databaseUrl).query(
        `INSERT INTO alert_preferences (
           fid, wallet_address, enabled, event_types, min_severity, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (fid) DO UPDATE SET
           wallet_address = EXCLUDED.wallet_address,
           enabled = EXCLUDED.enabled,
           event_types = EXCLUDED.event_types,
           min_severity = EXCLUDED.min_severity,
           updated_at = EXCLUDED.updated_at
         RETURNING fid, wallet_address, enabled, event_types, min_severity, updated_at`,
        [
          record.fid,
          normalizeWallet(record.walletAddress) ?? null,
          record.enabled,
          record.eventTypes,
          record.minSeverity,
          record.updatedAt
        ]
      );
      return rowToPreference(result.rows[0]);
    }
    return this.preferences.upsert(record, candidate => candidate.fid === input.fid);
  }

  async getPreferencesForWallet(walletAddress: string): Promise<AlertPreference | undefined> {
    const subscription = await this.getSubscriptionByWallet(walletAddress);
    if (subscription) return this.getPreference(subscription.fid);
    if (this.databaseUrl) {
      const normalized = normalizeWallet(walletAddress);
      const result = await getPool(this.databaseUrl).query(
        `SELECT a.fid, a.wallet_address, a.enabled, a.event_types, a.min_severity, a.updated_at
         FROM alert_preferences a
         JOIN user_profiles p ON p.farcaster_fid = a.fid
         WHERE LOWER(p.wallet_address) = $1
         LIMIT 1`,
        [normalized]
      );
      if (result.rows[0]) return rowToPreference(result.rows[0]);
      return this.getEmailPreferencesForWallet(walletAddress);
    }
    return this.preferences.find(candidate => normalizeWallet(candidate.walletAddress) === normalizeWallet(walletAddress));
  }

  async send(input: AlertInput): Promise<{ delivered: boolean; reason?: string }> {
    const fallbackInput = { ...input };
    const subscription = input.fid
      ? await this.getSubscription(input.fid)
      : input.walletAddress
        ? await this.getSubscriptionByWallet(input.walletAddress)
        : undefined;
    if (!subscription || !subscription.enabled) {
      const result = await this.sendEmail(fallbackInput, "notifications are not enabled for this wallet or fid");
      await this.recordEvent(input, result, result.delivered ? "email" : "none");
      return result;
    }

    const preference = await this.getPreference(subscription.fid);
    if (preference && (!preference.enabled || !preference.eventTypes.includes(input.type))) {
      const result = { delivered: false, reason: "alert suppressed by user preferences" };
      await this.recordEvent({ ...input, fid: subscription.fid, walletAddress: input.walletAddress ?? subscription.walletAddress }, result, "farcaster");
      return result;
    }

    const targetUrl = input.targetUrl ?? this.config.farcasterAppUrl;
    const response = await fetch(subscription.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        notificationId: randomUUID(),
        title: truncate(input.title, 32),
        body: truncate(input.body, 128),
        targetUrl,
        tokens: [subscription.token]
      })
    });

    if (!response.ok) {
      const result = await this.sendEmail(
        { ...fallbackInput, walletAddress: fallbackInput.walletAddress ?? subscription.walletAddress },
        `Farcaster notification endpoint returned ${response.status}`
      );
      await this.recordEvent({ ...input, fid: subscription.fid, walletAddress: input.walletAddress ?? subscription.walletAddress }, result, result.delivered ? "email" : "farcaster");
      return result;
    }
    const result = { delivered: true };
    await this.recordEvent({ ...input, fid: subscription.fid, walletAddress: input.walletAddress ?? subscription.walletAddress }, result, "farcaster");
    return result;
  }

  async hasEnabledSubscriptionForWallet(walletAddress: string): Promise<boolean> {
    return Boolean(await this.getSubscriptionByWallet(walletAddress));
  }

  async hasEnabledEmailForWallet(walletAddress: string): Promise<boolean> {
    return Boolean(await this.getEmailRecipient(walletAddress));
  }

  async sendWelcomeEmail(input: { walletAddress: string; emailAddress: string }): Promise<{ delivered: boolean; reason?: string }> {
    return this.sendEmail({
      walletAddress: input.walletAddress,
      type: "deposit_ready",
      title: "BitflowOS email alerts are enabled",
      body: "You will receive BitflowOS deposit, allocation, withdrawal, and risk alerts at this email address.",
      targetUrl: this.config.farcasterAppUrl
    }, undefined, input.emailAddress);
  }

  private async getSubscription(fid: number): Promise<FarcasterSubscription | undefined> {
    if (this.databaseUrl) {
      const result = await getPool(this.databaseUrl).query(
        `SELECT fid, url, token, wallet_address, enabled, created_at, updated_at
         FROM farcaster_subscriptions
         WHERE fid = $1`,
        [fid]
      );
      return result.rows[0] ? rowToSubscription(result.rows[0]) : undefined;
    }
    return this.subscriptions.find(candidate => candidate.fid === fid);
  }

  private async getSubscriptionByWallet(walletAddress: string): Promise<FarcasterSubscription | undefined> {
    const normalized = normalizeWallet(walletAddress);
    if (this.databaseUrl) {
      const result = await getPool(this.databaseUrl).query(
        `SELECT fid, url, token, wallet_address, enabled, created_at, updated_at
         FROM farcaster_subscriptions
         WHERE LOWER(wallet_address) = $1 AND enabled = TRUE
         ORDER BY updated_at DESC
         LIMIT 1`,
        [normalized]
      );
      if (result.rows[0]) return rowToSubscription(result.rows[0]);
      const byProfile = await getPool(this.databaseUrl).query(
        `SELECT s.fid, s.url, s.token, COALESCE(s.wallet_address, p.wallet_address) AS wallet_address,
                s.enabled, s.created_at, s.updated_at
         FROM farcaster_subscriptions s
         JOIN user_profiles p ON p.farcaster_fid = s.fid
         WHERE LOWER(p.wallet_address) = $1 AND s.enabled = TRUE
         ORDER BY s.updated_at DESC
         LIMIT 1`,
        [normalized]
      );
      return byProfile.rows[0] ? rowToSubscription(byProfile.rows[0]) : undefined;
    }
    return this.subscriptions.find(candidate => normalizeWallet(candidate.walletAddress) === normalized && candidate.enabled);
  }

  private async getPreference(fid: number): Promise<AlertPreference | undefined> {
    if (this.databaseUrl) {
      const result = await getPool(this.databaseUrl).query(
        `SELECT fid, wallet_address, enabled, event_types, min_severity, updated_at
         FROM alert_preferences
         WHERE fid = $1`,
        [fid]
      );
      return result.rows[0] ? rowToPreference(result.rows[0]) : undefined;
    }
    return this.preferences.find(candidate => candidate.fid === fid);
  }

  private async setEmailPreferences(input: AlertPreference): Promise<AlertPreference> {
    if (!input.walletAddress) throw new Error("walletAddress is required for email alert preferences.");
    const record = { ...input, updatedAt: new Date().toISOString() };
    if (this.databaseUrl) {
      const result = await getPool(this.databaseUrl).query(
        `INSERT INTO email_alert_preferences (
           wallet_address, enabled, event_types, min_severity, updated_at
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (wallet_address) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           event_types = EXCLUDED.event_types,
           min_severity = EXCLUDED.min_severity,
           updated_at = EXCLUDED.updated_at
         RETURNING wallet_address, enabled, event_types, min_severity, updated_at`,
        [
          normalizeWallet(record.walletAddress),
          record.enabled,
          record.eventTypes,
          record.minSeverity,
          record.updatedAt
        ]
      );
      return rowToEmailPreference(result.rows[0]);
    }
    return this.preferences.upsert(record, candidate => normalizeWallet(candidate.walletAddress) === normalizeWallet(record.walletAddress));
  }

  private async getEmailPreferencesForWallet(walletAddress: string): Promise<AlertPreference | undefined> {
    const normalized = normalizeWallet(walletAddress);
    if (this.databaseUrl) {
      const result = await getPool(this.databaseUrl).query(
        `SELECT wallet_address, enabled, event_types, min_severity, updated_at
         FROM email_alert_preferences
         WHERE LOWER(wallet_address) = $1
         LIMIT 1`,
        [normalized]
      );
      return result.rows[0] ? rowToEmailPreference(result.rows[0]) : undefined;
    }
    return this.preferences.find(candidate => !candidate.fid && normalizeWallet(candidate.walletAddress) === normalized);
  }

  private async sendEmail(input: AlertInput, fallbackReason?: string, overrideEmail?: string): Promise<{ delivered: boolean; reason?: string }> {
    const recipient = overrideEmail
      ? { emailAddress: overrideEmail, walletAddress: input.walletAddress }
      : input.walletAddress
        ? await this.getEmailRecipient(input.walletAddress)
        : undefined;
    if (!recipient?.emailAddress) {
      return { delivered: false, reason: fallbackReason ?? "email alerts are not enabled for this wallet" };
    }
    const preference = input.walletAddress ? await this.getEmailPreferencesForWallet(input.walletAddress) : undefined;
    if (preference && (!preference.enabled || !preference.eventTypes.includes(input.type))) {
      return { delivered: false, reason: "email alert suppressed by user preferences" };
    }
    if (!this.config.smtpServer || !this.config.smtpUsername || !this.config.smtpPassword || !this.config.fromEmail) {
      return { delivered: false, reason: "email alert sender is not configured" };
    }
    const transport = this.getEmailTransport();
    const targetUrl = input.targetUrl ?? this.config.farcasterAppUrl;
    await transport.sendMail({
      from: this.config.fromEmail,
      to: recipient.emailAddress,
      subject: truncate(input.title, 78),
      text: `${input.body}\n\nOpen BitflowOS: ${targetUrl}${input.transactionHash ? `\nTransaction: ${voyagerUrl(input.transactionHash)}` : ""}`,
      html: renderEmail({
        title: input.title,
        body: input.body,
        targetUrl,
        transactionHash: input.transactionHash
      })
    });
    return { delivered: true };
  }

  private async getEmailRecipient(walletAddress: string): Promise<{ walletAddress?: string; emailAddress?: string } | undefined> {
    const normalized = normalizeWallet(walletAddress);
    if (this.databaseUrl) {
      const result = await getPool(this.databaseUrl).query(
        `SELECT wallet_address, email_address
         FROM user_profiles
         WHERE LOWER(wallet_address) = $1
           AND email_alerts_enabled = TRUE
           AND email_address IS NOT NULL
         LIMIT 1`,
        [normalized]
      );
      return result.rows[0] ? {
        walletAddress: result.rows[0].wallet_address,
        emailAddress: result.rows[0].email_address
      } : undefined;
    }
    return undefined;
  }

  private getEmailTransport(): nodemailer.Transporter {
    if (!this.emailTransport) {
      this.emailTransport = nodemailer.createTransport({
        host: this.config.smtpServer,
        port: this.config.smtpPort,
        secure: this.config.smtpSecure,
        auth: {
          user: this.config.smtpUsername,
          pass: this.config.smtpPassword
        }
      });
    }
    return this.emailTransport;
  }

  private async recordEvent(input: AlertInput, result: { delivered: boolean; reason?: string }, deliveryChannel: "farcaster" | "email" | "none"): Promise<void> {
    if (!this.databaseUrl) return;
    const emailRecipient = deliveryChannel === "email" && input.walletAddress
      ? await this.getEmailRecipient(input.walletAddress)
      : undefined;
    await getPool(this.databaseUrl).query(
      `INSERT INTO alert_events (
         fid, wallet_address, event_type, title, body, target_url, severity,
         delivered, delivery_reason, transaction_hash, delivery_channel, email_address
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        input.fid ?? null,
        normalizeWallet(input.walletAddress),
        input.type,
        input.title,
        input.body,
        input.targetUrl ?? this.config.farcasterAppUrl,
        input.severity ?? "info",
        result.delivered,
        result.reason ?? null,
        input.transactionHash ?? null,
        deliveryChannel,
        emailRecipient?.emailAddress ?? null
      ]
    );
  }
}

function normalizeWallet(value?: string): string | undefined {
  return value?.toLowerCase();
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3))}...` : value;
}

function rowToSubscription(row: any): FarcasterSubscription {
  return {
    fid: Number(row.fid),
    url: row.url,
    token: row.token,
    walletAddress: row.wallet_address ?? undefined,
    enabled: Boolean(row.enabled),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function rowToPreference(row: any): AlertPreference {
  return {
    fid: Number(row.fid),
    walletAddress: row.wallet_address ?? undefined,
    enabled: Boolean(row.enabled),
    eventTypes: row.event_types ?? [],
    minSeverity: row.min_severity,
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function rowToEmailPreference(row: any): AlertPreference {
  return {
    walletAddress: row.wallet_address ?? undefined,
    enabled: Boolean(row.enabled),
    eventTypes: row.event_types ?? [],
    minSeverity: row.min_severity,
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function voyagerUrl(transactionHash: string) {
  return `https://sepolia.voyager.online/tx/${transactionHash}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function renderEmail(input: { title: string; body: string; targetUrl: string; transactionHash?: string }) {
  const tx = input.transactionHash
    ? `<p><a href="${voyagerUrl(input.transactionHash)}">View transaction</a></p>`
    : "";
  return [
    "<div style=\"font-family:Inter,Arial,sans-serif;background:#0b0f14;color:#f5f5f5;padding:24px;\">",
    "<div style=\"max-width:560px;margin:0 auto;border:1px solid #2a2a2a;padding:24px;\">",
    "<p style=\"color:#ff9f1a;letter-spacing:0.14em;text-transform:uppercase;font-size:12px;\">BitflowOS Alert</p>",
    `<h1 style=\"font-size:22px;margin:0 0 16px;\">${escapeHtml(input.title)}</h1>`,
    `<p style=\"line-height:1.6;color:#c8c8c8;\">${escapeHtml(input.body)}</p>`,
    `<p><a style=\"color:#ff9f1a;\" href=\"${input.targetUrl}\">Open BitflowOS</a></p>`,
    tx,
    "</div>",
    "</div>"
  ].join("");
}
