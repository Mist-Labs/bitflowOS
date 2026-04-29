import type { AllocationRecommendation, AppConfig, BridgeIntent, StarkZapConfig, VaultState, WalletOption } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    if (!response.ok) return fallback;
    return response.json() as Promise<T>;
  } catch {
    return fallback;
  }
}

export function getAppConfig(): Promise<AppConfig> {
  return getJson<AppConfig>("/api/config", {
    starknetNetwork: process.env.NEXT_PUBLIC_STARKNET_NETWORK ?? "sepolia",
    bitcoinNetwork: "testnet",
    contracts: {
      vault: process.env.NEXT_PUBLIC_BITFLOWOS_VAULT_ADDRESS ?? "",
      router: "",
      attestationRegistry: "",
      erc4626Adapter: "",
      leveragedVaultAdapter: "",
      ekuboAdapter: ""
    },
    vaultAddress: process.env.NEXT_PUBLIC_BITFLOWOS_VAULT_ADDRESS ?? "",
    tokens: [
      {
        symbol: "WBTC",
        address: "",
        decimals: 8,
        enabled: true
      }
    ],
    strategyRoutes: [],
    nativeBtcBridge: {
      provider: "atomiq",
      sources: ["BTC", "BTCLN"],
      defaultOutputToken: "WBTC"
    }
  });
}

export function getVaultState(userAddress?: string): Promise<VaultState> {
  const query = userAddress ? `?userAddress=${encodeURIComponent(userAddress)}` : "";
  return getJson<VaultState>(`/api/vault/state${query}`, {
    network: process.env.NEXT_PUBLIC_STARKNET_NETWORK ?? "sepolia",
    rpcUrl: process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? "",
    contracts: {
      vault: process.env.NEXT_PUBLIC_BITFLOWOS_VAULT_ADDRESS ?? "",
      router: "",
      attestationRegistry: "",
      erc4626Adapter: "",
      leveragedVaultAdapter: "",
      ekuboAdapter: ""
    },
    assets: [],
    strategies: []
  });
}

export function getWalletOptions(): Promise<WalletOption[]> {
  return getJson<WalletOption[]>("/api/wallet/options", [
    {
      id: "connect-wallet",
      label: "Connect Wallet",
      strategy: "external",
      recommendedFor: "Users who already have Argent, Braavos, or another Starknet wallet."
    },
    {
      id: "privy",
      label: "Continue with Email",
      strategy: "privy",
      recommendedFor: "Mainstream users who want embedded wallet UX without seed phrases.",
      enabled: Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID)
    },
    {
      id: "cartridge",
      label: "Use Passkey",
      strategy: "cartridge",
      recommendedFor: "Fast session UX with policy-bound sponsored BitflowOS calls.",
      enabled: true
    }
  ]);
}

export function getStarkZapConfig(): Promise<StarkZapConfig> {
  return getJson<StarkZapConfig>("/api/starkzap/config", {
    package: "starkzap",
    network: process.env.NEXT_PUBLIC_STARKNET_NETWORK ?? "sepolia",
    rpcUrl: process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? "",
    walletEntryPoints: [],
    paymasters: {},
    productModules: {}
  });
}

export async function createBridgeIntent(input: {
  amountSats: string;
  destinationAddress: string;
  outputToken: string;
  source: "BTC" | "BTCLN";
}): Promise<BridgeIntent> {
  const response = await fetch(`${API_URL}/api/btc-bridge/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error("Unable to create Atomiq bridge quote");
  }
  return response.json() as Promise<BridgeIntent>;
}

export async function buildDepositCalls(input: {
  tokenSymbol: string;
  amountBaseUnits: string;
}) {
  const response = await fetch(`${API_URL}/api/vault/deposit-calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error("Unable to build vault deposit calls");
  }
  return response.json();
}

export async function buildWithdrawCall(input: {
  tokenSymbol: string;
  sharesBaseUnits: string;
}) {
  const response = await fetch(`${API_URL}/api/vault/withdraw-call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error("Unable to build vault withdrawal call");
  }
  return response.json();
}

export async function buildHarvestCall(input: {
  tokenSymbol: string;
  strategyId: string;
}) {
  const response = await fetch(`${API_URL}/api/router/harvest-call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error("Unable to build harvest call");
  }
  return response.json();
}

export async function createRecommendation(input: {
  walletAddress?: string;
  assetSymbol?: string;
  amountBaseUnits?: string;
}): Promise<AllocationRecommendation> {
  const response = await fetch(`${API_URL}/api/ai/recommendation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error("Unable to create AI recommendation");
  }
  return response.json() as Promise<AllocationRecommendation>;
}

export async function deployCapital(input: {
  recommendation: AllocationRecommendation;
}): Promise<{
  status: "submitted" | "skipped";
  transactionHash?: string;
  attestationHash?: string;
  message: string;
  weights: Array<{ strategyId: string; asset: string; targetBps: number; label: string }>;
}> {
  const response = await fetch(`${API_URL}/api/ai/deploy-capital`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(detail?.message ?? "Unable to deploy capital on-chain");
  }
  return response.json();
}

export async function getPrivyStarknetWallet(input: {
  userId: string;
}): Promise<{
  walletId: string;
  address: string;
  publicKey: string;
  serverUrl: string;
}> {
  const response = await fetch(`${API_URL}/api/privy/starknet-wallet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error("Unable to prepare the StarkZap Privy wallet.");
  }
  return response.json();
}

export async function getUserProfile(walletAddress: string): Promise<{
  walletAddress: string;
  farcasterUsername?: string;
  farcasterFid?: number;
  farcasterNotificationsEnabled?: boolean;
}> {
  return getJson(`/api/users/${encodeURIComponent(walletAddress)}`, {
    walletAddress
  });
}

export async function setFarcasterUsername(input: {
  walletAddress: string;
  farcasterUsername: string;
  farcasterFid?: number;
}): Promise<{ welcome: string; alerts: string[]; farcasterNotificationsEnabled?: boolean }> {
  const response = await fetch(`${API_URL}/api/users/farcaster-username`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error("Unable to set Farcaster username");
  }
  return response.json() as Promise<{ welcome: string; alerts: string[]; farcasterNotificationsEnabled?: boolean }>;
}

export async function sendPositionAlert(input: {
  walletAddress: string;
  type: "deposit_confirmed" | "staking_started" | "withdrawal_requested" | "withdrawal_completed" | "transaction_failed";
  title: string;
  body: string;
  transactionHash?: string;
}): Promise<{ delivered: boolean; reason?: string }> {
  const response = await fetch(`${API_URL}/api/alerts/position-event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) return { delivered: false, reason: "alert endpoint failed" };
  return response.json() as Promise<{ delivered: boolean; reason?: string }>;
}

export async function saveFarcasterClientSubscription(input: {
  walletAddress: string;
  fid: number;
  username?: string;
  notificationDetails: {
    url: string;
    token: string;
  };
}): Promise<{ ok: boolean; farcasterNotificationsEnabled?: boolean }> {
  const response = await fetch(`${API_URL}/api/alerts/farcaster/client-subscription`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error("Unable to enable Farcaster inbox alerts.");
  }
  return response.json() as Promise<{ ok: boolean; farcasterNotificationsEnabled?: boolean }>;
}
