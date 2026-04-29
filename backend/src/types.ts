export type SupportedNetwork = "mainnet" | "sepolia" | "devnet";

export type BitcoinNetworkName = "mainnet" | "testnet" | "testnet4";

export type BridgeIntentStatus =
  | "quote_created"
  | "payment_detected"
  | "btc_confirmed"
  | "claimed_to_starknet"
  | "expired"
  | "failed";

export type AlertEventType =
  | "bridge_started"
  | "bridge_payment_detected"
  | "bridge_completed"
  | "deposit_ready"
  | "deposit_confirmed"
  | "staking_started"
  | "harvest_available"
  | "harvest_executed"
  | "unstake_started"
  | "withdrawal_requested"
  | "withdrawal_completed"
  | "position_health_warning"
  | "strategy_paused"
  | "transaction_failed";

export interface TokenConfig {
  symbol: string;
  address: string;
  decimals: number;
  enabled: boolean;
  kind?: "mock" | "wrapped_btc" | "lst" | "lp" | string;
}

export interface BridgeIntentRecord {
  id: string;
  status: BridgeIntentStatus;
  userId?: string;
  farcasterFid?: number;
  source: "BTC" | "BTCLN";
  destinationAddress: string;
  outputToken: string;
  outputTokenAddress?: string;
  inputAmountSats: string;
  expectedOutputAmount?: string;
  feeAmountSats?: string;
  paymentAddress?: string;
  paymentUri?: string;
  swapState?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface FarcasterSubscription {
  fid: number;
  url: string;
  token: string;
  walletAddress?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AlertPreference {
  fid: number;
  walletAddress?: string;
  enabled: boolean;
  eventTypes: AlertEventType[];
  minSeverity: "info" | "warning" | "critical";
  updatedAt: string;
}

export interface UserProfile {
  walletAddress: string;
  farcasterUsername?: string;
  farcasterFid?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AllocationRecommendation {
  id: string;
  walletAddress?: string;
  assetSymbol: string;
  status: "ready" | "fallback" | "blocked";
  confidenceBps: number;
  weights: Array<{
    strategyId: string;
    label: string;
    targetBps: number;
    rationale: string;
  }>;
  riskChecks: Array<{
    id: string;
    label: string;
    passed: boolean;
    detail: string;
  }>;
  reasoning: string;
  attestation: {
    provider: string;
    verified: boolean;
    verificationMode: "0g" | "external" | "not_configured";
    chatId?: string;
    providerAddress?: string;
    attestationHash?: string;
    setupRequired?: string[];
  };
  createdAt: string;
}

export interface StarknetCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

export interface StrategyRouteConfig {
  id: string;
  label: string;
  adapterAddress: string;
  maxBps: number;
  assetSymbol: string;
  enabled: boolean;
  kind: "erc4626" | "ekubo" | "leveraged" | string;
  vaultAddress?: string;
  quoteRequired?: boolean;
  uiEnabled?: boolean;
  disabledReason?: string;
  executionEnabled?: boolean;
  pool?: EkuboPoolRouteConfig;
}

export interface EkuboPoolRouteConfig {
  chainId: string;
  apiUrl: string;
  positionsAddress: string;
  coreAddress: string;
  routerAddress: string;
  poolId?: string;
  token0: string;
  token1: string;
  token0Symbol?: string;
  token1Symbol?: string;
  fee: string;
  tickSpacing: number;
  extension: string;
  lowerTick: number;
  upperTick: number;
  assetIsToken1: boolean;
  minLiquidity: string;
  minWithdrawToken0: string;
  minWithdrawToken1: string;
}
