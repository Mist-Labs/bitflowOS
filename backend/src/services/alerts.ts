import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { AlertEventType, AlertPreference, FarcasterSubscription } from "../types.js";
import { JsonStore } from "../storage/jsonStore.js";

export interface AlertInput {
  fid: number;
  type: AlertEventType;
  title: string;
  body: string;
  targetUrl?: string;
  severity?: "info" | "warning" | "critical";
}

export class AlertService {
  private readonly subscriptions: JsonStore<FarcasterSubscription>;
  private readonly preferences: JsonStore<AlertPreference>;

  constructor(private readonly config: AppConfig) {
    this.subscriptions = JsonStore.forCollection<FarcasterSubscription>(config.dataDir, "farcaster-subscriptions");
    this.preferences = JsonStore.forCollection<AlertPreference>(config.dataDir, "alert-preferences");
  }

  async upsertSubscription(input: {
    fid: number;
    url: string;
    token: string;
    walletAddress?: string;
    enabled?: boolean;
  }): Promise<FarcasterSubscription> {
    const now = new Date().toISOString();
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
    return this.preferences.upsert(record, candidate => candidate.fid === input.fid);
  }

  async send(input: AlertInput): Promise<{ delivered: boolean; reason?: string }> {
    const subscription = await this.subscriptions.find(candidate => candidate.fid === input.fid);
    if (!subscription || !subscription.enabled) {
      return { delivered: false, reason: "notifications are not enabled for fid" };
    }

    const preference = await this.preferences.find(candidate => candidate.fid === input.fid);
    if (preference && (!preference.enabled || !preference.eventTypes.includes(input.type))) {
      return { delivered: false, reason: "alert suppressed by user preferences" };
    }

    const targetUrl = input.targetUrl ?? this.config.farcasterAppUrl;
    if (this.config.neynarApiKey) {
      const response = await fetch("https://api.neynar.com/v2/farcaster/frame/notifications/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.neynarApiKey
        },
        body: JSON.stringify({
          notification: {
            title: input.title,
            body: input.body,
            target_url: targetUrl,
            uuid: randomUUID()
          },
          target_fids: [input.fid]
        })
      });
      if (!response.ok) {
        return { delivered: false, reason: `Neynar returned ${response.status}` };
      }
      return { delivered: true };
    }

    const response = await fetch(subscription.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        notificationId: randomUUID(),
        title: input.title,
        body: input.body,
        targetUrl,
        tokens: [subscription.token]
      })
    });

    if (!response.ok) {
      return { delivered: false, reason: `Farcaster notification endpoint returned ${response.status}` };
    }
    return { delivered: true };
  }
}
