import type { AppConfig } from "../config.js";
import type { UserProfile } from "../types.js";
import { JsonStore } from "../storage/jsonStore.js";

export class UserProfileService {
  private readonly profiles: JsonStore<UserProfile>;

  constructor(config: AppConfig) {
    this.profiles = JsonStore.forCollection<UserProfile>(config.dataDir, "user-profiles");
  }

  async get(walletAddress: string): Promise<UserProfile | undefined> {
    const normalized = normalizeWallet(walletAddress);
    return this.profiles.find(profile => normalizeWallet(profile.walletAddress) === normalized);
  }

  async setFarcasterUsername(input: {
    walletAddress: string;
    farcasterUsername: string;
  }): Promise<UserProfile> {
    const walletAddress = normalizeWallet(input.walletAddress);
    const now = new Date().toISOString();
    const existing = await this.get(walletAddress);
    const username = input.farcasterUsername.replace(/^@/, "").trim();
    if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) {
      throw new Error("Farcaster username must be 2-32 characters.");
    }

    const profile: UserProfile = {
      walletAddress,
      farcasterUsername: username,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    return this.profiles.upsert(profile, candidate => normalizeWallet(candidate.walletAddress) === walletAddress);
  }
}

function normalizeWallet(value: string): string {
  return value.toLowerCase();
}
