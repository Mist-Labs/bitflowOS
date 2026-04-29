import type { AppConfig } from "../config.js";

type PrivyWallet = {
  id: string;
  address: string;
  chain_type: string;
  public_key?: string;
};

type WalletListResponse = {
  data?: PrivyWallet[];
};

type RawSignResponse = {
  data?: {
    signature?: string;
  };
  signature?: string;
};

export class PrivyStarkZapService {
  constructor(private readonly config: AppConfig) {}

  get configured() {
    return Boolean(this.config.privyAppId && this.config.privyAppSecret);
  }

  async getOrCreateStarknetWallet(userId: string): Promise<PrivyWallet> {
    this.assertConfigured();
    const existing = await this.findStarknetWallet(userId);
    if (existing) return existing;

    const response = await this.request<PrivyWallet>("/v1/wallets", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "privy-idempotency-key": `bitflowos-starknet-${safeId(userId)}`
      },
      body: JSON.stringify({
        chain_type: "starknet",
        owner: { user_id: userId },
        display_name: "BitflowOS Starknet"
      })
    });

    return this.assertStarknetWalletReady(response);
  }

  async rawSign(walletId: string, hash: string): Promise<string> {
    this.assertConfigured();
    if (!/^0x[0-9a-fA-F]+$/.test(hash)) {
      throw new Error("Privy raw-sign requires a hex hash.");
    }

    const response = await this.request<RawSignResponse>(`/v1/wallets/${encodeURIComponent(walletId)}/raw_sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ params: { hash } })
    });
    const signature = response.data?.signature ?? response.signature;
    if (!signature) throw new Error("Privy raw-sign returned no signature.");
    return signature;
  }

  private async findStarknetWallet(userId: string) {
    const params = new URLSearchParams({
      chain_type: "starknet",
      user_id: userId,
      limit: "100"
    });
    const response = await this.request<WalletListResponse>(`/v1/wallets?${params.toString()}`);
    const wallet = response.data?.find(item => item.chain_type === "starknet");
    return wallet ? this.assertStarknetWalletReady(wallet) : undefined;
  }

  private assertStarknetWalletReady(wallet: PrivyWallet) {
    if (!wallet.id || !wallet.address || !wallet.public_key) {
      throw new Error("Privy Starknet wallet is missing its id, address, or public key.");
    }
    return wallet;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`https://api.privy.io${path}`, {
      ...init,
      headers: {
        authorization: `Basic ${Buffer.from(`${this.config.privyAppId}:${this.config.privyAppSecret}`).toString("base64")}`,
        "privy-app-id": this.config.privyAppId,
        ...init.headers
      }
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Privy StarkZap request failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
    }
    return response.json() as Promise<T>;
  }

  private assertConfigured() {
    if (!this.config.privyAppId || !this.config.privyAppSecret) {
      throw new Error("Privy StarkZap is not configured. Set PRIVY_APP_ID and PRIVY_APP_SECRET.");
    }
  }
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
