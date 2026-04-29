import { randomUUID } from "node:crypto";
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

  async send(input: AlertInput): Promise<{ delivered: boolean; reason?: string }> {
    const subscription = input.fid
      ? await this.getSubscription(input.fid)
      : input.walletAddress
        ? await this.getSubscriptionByWallet(input.walletAddress)
        : undefined;
    if (!subscription || !subscription.enabled) {
      const result = { delivered: false, reason: "notifications are not enabled for this wallet or fid" };
      await this.recordEvent(input, result);
      return result;
    }

    const preference = await this.getPreference(subscription.fid);
    if (preference && (!preference.enabled || !preference.eventTypes.includes(input.type))) {
      const result = { delivered: false, reason: "alert suppressed by user preferences" };
      await this.recordEvent({ ...input, fid: subscription.fid, walletAddress: input.walletAddress ?? subscription.walletAddress }, result);
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
      const result = { delivered: false, reason: `Farcaster notification endpoint returned ${response.status}` };
      await this.recordEvent({ ...input, fid: subscription.fid, walletAddress: input.walletAddress ?? subscription.walletAddress }, result);
      return result;
    }
    const result = { delivered: true };
    await this.recordEvent({ ...input, fid: subscription.fid, walletAddress: input.walletAddress ?? subscription.walletAddress }, result);
    return result;
  }

  async hasEnabledSubscriptionForWallet(walletAddress: string): Promise<boolean> {
    return Boolean(await this.getSubscriptionByWallet(walletAddress));
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

  private async recordEvent(input: AlertInput, result: { delivered: boolean; reason?: string }): Promise<void> {
    if (!this.databaseUrl) return;
    await getPool(this.databaseUrl).query(
      `INSERT INTO alert_events (
         fid, wallet_address, event_type, title, body, target_url, severity, delivered, delivery_reason, transaction_hash
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
        input.transactionHash ?? null
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
