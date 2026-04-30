export type WalletOption = {
  id: "connect-wallet" | "privy" | "cartridge";
  label: string;
  strategy: string;
  recommendedFor: string;
  enabled?: boolean;
  paymaster?: string;
  namespace?: string;
  policies?: Array<{
    target: string;
    method: string;
  }>;
};

export type TokenConfig = {
  symbol: string;
  address: string;
  decimals: number;
  enabled: boolean;
  kind?: string;
};

export type StrategyRouteConfig = {
  id: string;
  label: string;
  adapterAddress: string;
  maxBps: number;
  assetSymbol: string;
  enabled: boolean;
  kind: string;
  vaultAddress?: string;
  quoteRequired?: boolean;
  uiEnabled?: boolean;
  disabledReason?: string;
  executionEnabled?: boolean;
  pool?: {
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
  };
};

export type AppConfig = {
  starknetNetwork: string;
  bitcoinNetwork: string;
  contracts?: {
    vault: string;
    router: string;
    attestationRegistry: string;
    erc4626Adapter: string;
    leveragedVaultAdapter: string;
    ekuboAdapter: string;
  };
  vaultAddress: string;
  tokens: TokenConfig[];
  strategyRoutes?: StrategyRouteConfig[];
  nativeBtcBridge: {
    provider: string;
    sources: string[];
    defaultOutputToken: string;
  };
};

export type VaultState = {
  network: string;
  rpcUrl: string;
  contracts: NonNullable<AppConfig["contracts"]>;
  assets: Array<{
    symbol: string;
    address: string;
    decimals: number;
    kind?: string;
    supported: boolean;
    totalAssets: string;
    userShares: string;
    userAssetShares: string;
    userWalletBalance: string;
  }>;
  strategies: Array<StrategyRouteConfig & {
    configured: boolean;
    routerPosition?: string;
    adapterPosition?: string;
  }>;
};

export type StarkZapConfig = {
  package: string;
  network: string;
  rpcUrl: string;
  walletEntryPoints: unknown[];
  paymasters: {
    avnu?: {
      enabled?: boolean;
      nodeUrl?: string;
      usedFor?: string[];
    };
    cartridge?: {
      enabled?: boolean;
      policyBound?: boolean;
    };
  };
  productModules: Record<string, unknown>;
};

export type BridgeIntent = {
  id: string;
  status: string;
  source: "BTC" | "BTCLN";
  destinationAddress: string;
  outputToken: string;
  inputAmountSats: string;
  expectedOutputAmount?: string;
  paymentAddress?: string;
  paymentUri?: string;
  createdAt: string;
};

export type Strategy = {
  id: string;
  name: string;
  protocol: string;
  asset: string;
  allocation: number;
  apy: string;
  risk: "low" | "medium" | "high";
  status: "live" | "ready" | "pending" | "guarded";
  description: string;
};

export type AllocationRecommendation = {
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
};
