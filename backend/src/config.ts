import dotenv from "dotenv";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  BitcoinNetworkName,
  StrategyRouteConfig,
  SupportedNetwork,
  TokenConfig
} from "./types.js";

dotenv.config();
const rootEnvPath = resolve(process.cwd(), "../.env");
if (existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true });
}

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  HOST: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
  BACKEND_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  BACKEND_HOST: z.string().optional(),
  BACKEND_CORS_ORIGIN: z.string().optional(),
  BACKEND_DATA_DIR: z.string().optional(),
  STARKNET_NETWORK: z.enum(["mainnet", "sepolia", "devnet"]).default("mainnet"),
  STARKNET_RPC_URL: z.string().url(),
  BITFLOWOS_VAULT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]+$/),
  BITFLOWOS_ATTESTATION_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]+$/).or(z.literal("")).default(""),
  BITFLOWOS_STRATEGY_ROUTER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]+$/).or(z.literal("")).default(""),
  BITFLOWOS_ERC4626_ADAPTER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]+$/).or(z.literal("")).default(""),
  BITFLOWOS_LEVERAGED_VAULT_ADAPTER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]+$/).or(z.literal("")).default(""),
  BITFLOWOS_EKUBO_ADAPTER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]+$/).or(z.literal("")).default(""),
  BITCOIN_NETWORK: z.enum(["mainnet", "testnet", "testnet4"]).default("mainnet"),
  ATOMIQ_DEFAULT_OUTPUT_TOKEN: z.string().default("WBTC"),
  ATOMIQ_GAS_DROP_FRI: z.string().regex(/^\d+$/).default("0"),
  ATOMIQ_LP_URL: z.string().url().or(z.literal("")).default(""),
  ATOMIQ_MEMPOOL_API_URL: z.string().url().or(z.literal("")).default(""),
  ATOMIQ_PRICING_API_URL: z.string().url().or(z.literal("")).default(""),
  SUPPORTED_TOKENS_JSON: z.string().optional().default(""),
  STRATEGY_ROUTES_JSON: z.string().optional().default(""),
  EKUBO_API_URL: z.string().url().default("https://prod-api.ekubo.org"),
  EKUBO_CHAIN_ID: z.string().default("0x534e5f4d41494f"),
  AVNU_PAYMASTER_NODE_URL: z.string().url().or(z.literal("")).default(""),
  PRIVY_APP_ID: z.string().optional().default(""),
  PRIVY_APP_SECRET: z.string().optional().default(""),
  PRIVY_SERVER_URL: z.string().url().or(z.literal("")).default(""),
  CARTRIDGE_NAMESPACE: z.string().optional().default("bitflowos"),
  NEYNAR_API_KEY: z.string().optional().default(""),
  FARCASTER_APP_URL: z.string().url().default("http://localhost:3000"),
  DATA_DIR: z.string().default("./data"),
  KIMI_API_KEY: z.string().optional().default(""),
  KIMI_MODEL: z.string().optional().default("kimi-k2-0905-preview"),
  KIMI_BASE_URL: z.string().url().optional(),
  KIMI_API_BASE_URL: z.string().url().default("https://api.moonshot.ai/v1"),
  TEE_PROVIDER: z.string().optional().default("0g"),
  TEE_ATTESTATION_VERIFY_URL: z.string().url().or(z.literal("")).default(""),
  ZG_PRIVATE_KEY: z.string().optional().default(""),
  ZG_RPC_URL: z.string().url().default("https://evmrpc-testnet.0g.ai"),
  ZG_PROVIDER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).or(z.literal("")).default(""),
  ZG_REPORTS_DIR: z.string().optional().default("./data/0g-reports"),
  POLICY_MIN_CONFIDENCE_BPS: z.coerce.number().int().min(0).max(10000).default(7000),
  POLICY_MIN_IDLE_RESERVE_BPS: z.coerce.number().int().min(0).max(10000).default(1000),
  POLICY_MAX_LP_BPS: z.coerce.number().int().min(0).max(10000).default(1500),
  POLICY_MAX_STRATEGY_BPS: z.coerce.number().int().min(0).max(10000).default(6000)
});

export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  corsOrigin: string;
  starknetNetwork: SupportedNetwork;
  starknetRpcUrl: string;
  bitflowosVaultAddress: string;
  bitflowosAttestationRegistryAddress: string;
  bitflowosStrategyRouterAddress: string;
  bitflowosErc4626AdapterAddress: string;
  bitflowosLeveragedVaultAdapterAddress: string;
  bitflowosEkuboAdapterAddress: string;
  bitcoinNetwork: BitcoinNetworkName;
  atomiqDefaultOutputToken: string;
  atomiqGasDropFri: string;
  atomiqLpUrl: string;
  atomiqMempoolApiUrl: string;
  atomiqPricingApiUrl: string;
  avnuPaymasterNodeUrl: string;
  privyAppId: string;
  privyAppSecret: string;
  privyServerUrl: string;
  cartridgeNamespace: string;
  neynarApiKey: string;
  farcasterAppUrl: string;
  dataDir: string;
  kimiApiKey: string;
  kimiModel: string;
  kimiApiBaseUrl: string;
  teeProvider: string;
  teeAttestationVerifyUrl: string;
  zgPrivateKey: string;
  zgRpcUrl: string;
  zgProviderAddress: string;
  zgReportsDir: string;
  policy: {
    minConfidenceBps: number;
    minIdleReserveBps: number;
    maxLpBps: number;
    maxStrategyBps: number;
  };
  tokens: Record<string, TokenConfig>;
  strategyRoutes: Record<string, StrategyRouteConfig>;
  ekuboApiUrl: string;
  ekuboChainId: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.BACKEND_PORT ?? parsed.PORT ?? 8787,
    host: parsed.BACKEND_HOST ?? parsed.HOST ?? "127.0.0.1",
    corsOrigin: parsed.BACKEND_CORS_ORIGIN ?? parsed.CORS_ORIGIN ?? "http://localhost:3000",
    starknetNetwork: parsed.STARKNET_NETWORK,
    starknetRpcUrl: parsed.STARKNET_RPC_URL,
    bitflowosVaultAddress: parsed.BITFLOWOS_VAULT_ADDRESS,
    bitflowosAttestationRegistryAddress: parsed.BITFLOWOS_ATTESTATION_REGISTRY_ADDRESS,
    bitflowosStrategyRouterAddress: parsed.BITFLOWOS_STRATEGY_ROUTER_ADDRESS,
    bitflowosErc4626AdapterAddress: parsed.BITFLOWOS_ERC4626_ADAPTER_ADDRESS,
    bitflowosLeveragedVaultAdapterAddress: parsed.BITFLOWOS_LEVERAGED_VAULT_ADAPTER_ADDRESS,
    bitflowosEkuboAdapterAddress: parsed.BITFLOWOS_EKUBO_ADAPTER_ADDRESS,
    bitcoinNetwork: parsed.BITCOIN_NETWORK,
    atomiqDefaultOutputToken: parsed.ATOMIQ_DEFAULT_OUTPUT_TOKEN.toUpperCase(),
    atomiqGasDropFri: parsed.ATOMIQ_GAS_DROP_FRI,
    atomiqLpUrl: parsed.ATOMIQ_LP_URL.replace(/\/$/, ""),
    atomiqMempoolApiUrl: parsed.ATOMIQ_MEMPOOL_API_URL,
    atomiqPricingApiUrl: parsed.ATOMIQ_PRICING_API_URL.replace(/\/$/, ""),
    avnuPaymasterNodeUrl: parsed.AVNU_PAYMASTER_NODE_URL,
    privyAppId: parsed.PRIVY_APP_ID,
    privyAppSecret: parsed.PRIVY_APP_SECRET,
    privyServerUrl: parsed.PRIVY_SERVER_URL,
    cartridgeNamespace: parsed.CARTRIDGE_NAMESPACE,
    neynarApiKey: parsed.NEYNAR_API_KEY,
    farcasterAppUrl: parsed.FARCASTER_APP_URL,
    dataDir: parsed.BACKEND_DATA_DIR ?? parsed.DATA_DIR,
    kimiApiKey: parsed.KIMI_API_KEY,
    kimiModel: parsed.KIMI_MODEL,
    kimiApiBaseUrl: (parsed.KIMI_BASE_URL ?? parsed.KIMI_API_BASE_URL).replace(/\/$/, ""),
    teeProvider: parsed.TEE_PROVIDER || "0g",
    teeAttestationVerifyUrl: parsed.TEE_ATTESTATION_VERIFY_URL,
    zgPrivateKey: parsed.ZG_PRIVATE_KEY,
    zgRpcUrl: parsed.ZG_RPC_URL,
    zgProviderAddress: parsed.ZG_PROVIDER_ADDRESS,
    zgReportsDir: parsed.ZG_REPORTS_DIR,
    policy: {
      minConfidenceBps: parsed.POLICY_MIN_CONFIDENCE_BPS,
      minIdleReserveBps: parsed.POLICY_MIN_IDLE_RESERVE_BPS,
      maxLpBps: parsed.POLICY_MAX_LP_BPS,
      maxStrategyBps: parsed.POLICY_MAX_STRATEGY_BPS
    },
    tokens: parseTokenConfig(parsed.SUPPORTED_TOKENS_JSON, parsed.STARKNET_NETWORK),
    strategyRoutes: parseStrategyRoutes(parsed.STRATEGY_ROUTES_JSON),
    ekuboApiUrl: parsed.EKUBO_API_URL.replace(/\/$/, ""),
    ekuboChainId: parsed.EKUBO_CHAIN_ID
  };
}

function parseTokenConfig(raw: string, network: SupportedNetwork): Record<string, TokenConfig> {
  if (!raw) return defaultTokens(network);
  const parsed = z.record(z.object({
    symbol: z.string().optional(),
    address: z.string().regex(/^0x[0-9a-fA-F]+$/),
    decimals: z.number().int().min(0).max(36),
    enabled: z.boolean(),
    kind: z.string().optional()
  })).parse(JSON.parse(raw));

  return Object.fromEntries(
    Object.entries(parsed).map(([key, token]) => [key.toUpperCase(), {
      ...token,
      symbol: (token.symbol ?? key).toUpperCase()
    }])
  );
}

function parseStrategyRoutes(raw: string): Record<string, StrategyRouteConfig> {
  if (!raw) return {};
  const parsed = z.record(z.object({
    id: z.string().optional(),
    label: z.string(),
    adapterAddress: z.string().regex(/^0x[0-9a-fA-F]+$/),
    maxBps: z.number().int().min(0).max(10000),
    assetSymbol: z.string(),
    enabled: z.boolean(),
    kind: z.string(),
    vaultAddress: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
    quoteRequired: z.boolean().optional().default(false),
    uiEnabled: z.boolean().optional(),
    disabledReason: z.string().optional(),
    executionEnabled: z.boolean().optional().default(false),
    pool: z.object({
      chainId: z.string(),
      apiUrl: z.string().url(),
      positionsAddress: z.string().regex(/^0x[0-9a-fA-F]+$/),
      coreAddress: z.string().regex(/^0x[0-9a-fA-F]+$/),
      routerAddress: z.string().regex(/^0x[0-9a-fA-F]+$/),
      poolId: z.string().optional(),
      token0: z.string().regex(/^0x[0-9a-fA-F]+$/),
      token1: z.string().regex(/^0x[0-9a-fA-F]+$/),
      token0Symbol: z.string().optional(),
      token1Symbol: z.string().optional(),
      fee: z.string().regex(/^\d+$/),
      tickSpacing: z.number().int().positive(),
      extension: z.string().regex(/^0x[0-9a-fA-F]+$/),
      lowerTick: z.number().int(),
      upperTick: z.number().int(),
      assetIsToken1: z.boolean(),
      minLiquidity: z.string().regex(/^\d+$/),
      minWithdrawToken0: z.string().regex(/^\d+$/),
      minWithdrawToken1: z.string().regex(/^\d+$/)
    }).optional()
  })).parse(JSON.parse(raw));

  return Object.fromEntries(
    Object.entries(parsed).map(([key, route]) => [key.toUpperCase(), {
      ...route,
      id: route.id ?? key.toUpperCase(),
      assetSymbol: route.assetSymbol.toUpperCase()
    }])
  );
}

function defaultTokens(network: SupportedNetwork): Record<string, TokenConfig> {
  if (network !== "mainnet") {
    return {};
  }

  // Keep additional BTC wrappers in SUPPORTED_TOKENS_JSON after final address verification.
  return {
    WBTC: {
      symbol: "WBTC",
      address: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
      decimals: 8,
      enabled: true
    }
  };
}
