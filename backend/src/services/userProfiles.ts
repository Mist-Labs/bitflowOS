import type { AppConfig } from "../config.js";
import type { UserProfile } from "../types.js";
import { JsonStore } from "../storage/jsonStore.js";
import { getPool } from "../storage/postgres.js";

export class UserProfileService {
  private readonly profiles: JsonStore<UserProfile>;
  private readonly databaseUrl: string;

  constructor(private readonly config: AppConfig) {
    this.profiles = JsonStore.forCollection<UserProfile>(config.dataDir, "user-profiles");
    this.databaseUrl = config.databaseUrl;
  }

  async get(walletAddress: string): Promise<UserProfile | undefined> {
    const normalized = normalizeWallet(walletAddress);
    if (this.databaseUrl) {
      const result = await getPool(this.databaseUrl).query(
        `SELECT wallet_address, farcaster_username, farcaster_fid, created_at, updated_at
         FROM user_profiles
         WHERE LOWER(wallet_address) = $1`,
        [normalized]
      );
      return result.rows[0] ? rowToProfile(result.rows[0]) : undefined;
    }
    return this.profiles.find(profile => normalizeWallet(profile.walletAddress) === normalized);
  }

  async getByFid(fid: number): Promise<UserProfile | undefined> {
    if (this.databaseUrl) {
      const result = await getPool(this.databaseUrl).query(
        `SELECT wallet_address, farcaster_username, farcaster_fid, created_at, updated_at
         FROM user_profiles
         WHERE farcaster_fid = $1`,
        [fid]
      );
      return result.rows[0] ? rowToProfile(result.rows[0]) : undefined;
    }
    return this.profiles.find(profile => profile.farcasterFid === fid);
  }

  async getByUsername(usernameInput: string): Promise<UserProfile | undefined> {
    const username = normalizeUsername(usernameInput);
    if (this.databaseUrl) {
      const result = await getPool(this.databaseUrl).query(
        `SELECT wallet_address, farcaster_username, farcaster_fid, created_at, updated_at
         FROM user_profiles
         WHERE LOWER(farcaster_username) = $1`,
        [username.toLowerCase()]
      );
      return result.rows[0] ? rowToProfile(result.rows[0]) : undefined;
    }
    return this.profiles.find(profile => profile.farcasterUsername?.toLowerCase() === username.toLowerCase());
  }

  async setFarcasterUsername(input: {
    walletAddress: string;
    farcasterUsername: string;
    farcasterFid?: number;
  }): Promise<UserProfile> {
    const walletAddress = normalizeWallet(input.walletAddress);
    const now = new Date().toISOString();
    const existing = await this.get(walletAddress);
    const username = normalizeUsername(input.farcasterUsername);
    if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) {
      throw new Error("Farcaster username must be 2-32 characters.");
    }

    const profile: UserProfile = {
      walletAddress,
      farcasterUsername: username,
      farcasterFid: input.farcasterFid ?? existing?.farcasterFid ?? await this.resolveFid(username),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    if (this.databaseUrl) {
      const result = await getPool(this.databaseUrl).query(
        `INSERT INTO user_profiles (
           wallet_address, farcaster_username, farcaster_fid, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (wallet_address) DO UPDATE SET
           farcaster_username = EXCLUDED.farcaster_username,
           farcaster_fid = COALESCE(EXCLUDED.farcaster_fid, user_profiles.farcaster_fid),
           updated_at = EXCLUDED.updated_at
         RETURNING wallet_address, farcaster_username, farcaster_fid, created_at, updated_at`,
        [profile.walletAddress, profile.farcasterUsername, profile.farcasterFid ?? null, now, now]
      );
      return rowToProfile(result.rows[0]);
    }
    return this.profiles.upsert(profile, candidate => normalizeWallet(candidate.walletAddress) === walletAddress);
  }

  private async resolveFid(username: string): Promise<number | undefined> {
    if (!this.config.neynarApiKey) return undefined;
    try {
      const response = await fetch(
        `https://api.neynar.com/v2/farcaster/user/by_username?username=${encodeURIComponent(username)}`,
        { headers: { "x-api-key": this.config.neynarApiKey } }
      );
      if (!response.ok) return undefined;
      const data = await response.json() as { user?: { fid?: number }; result?: { user?: { fid?: number } } };
      return data.user?.fid ?? data.result?.user?.fid;
    } catch {
      return undefined;
    }
  }
}

function normalizeWallet(value: string): string {
  return value.toLowerCase();
}

function normalizeUsername(value: string): string {
  return value.replace(/^@/, "").trim();
}

function rowToProfile(row: any): UserProfile {
  return {
    walletAddress: row.wallet_address,
    farcasterUsername: row.farcaster_username ?? undefined,
    farcasterFid: row.farcaster_fid ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}
