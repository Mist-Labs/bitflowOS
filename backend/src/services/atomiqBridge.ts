import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { BridgeIntentRecord } from "../types.js";
import { assertPositiveIntegerString } from "../lib/amounts.js";
import { assertStarknetAddress } from "../lib/starknet.js";
import { JsonStore } from "../storage/jsonStore.js";

type RuntimeSwap = {
  getAddress?: () => string;
  getHyperlink?: () => string;
  getInput?: () => bigint;
  getInputWithoutFee?: () => bigint;
  getFee?: () => { amountInSrcToken?: bigint };
  getOutput?: () => bigint;
  getState?: () => unknown;
  waitTillClaimed?: () => Promise<void>;
};

export interface CreateBtcBridgeIntentInput {
  amountSats: string;
  destinationAddress: string;
  outputToken?: string;
  source?: "BTC" | "BTCLN";
  userId?: string;
  farcasterFid?: number;
}

export class AtomiqBridgeService {
  private swapperPromise?: Promise<any>;
  private readonly runtimeSwaps = new Map<string, RuntimeSwap>();
  private readonly store: JsonStore<BridgeIntentRecord>;

  constructor(private readonly config: AppConfig) {
    this.store = JsonStore.forCollection<BridgeIntentRecord>(config.dataDir, "bridge-intents");
  }

  async createBtcToStarknetIntent(input: CreateBtcBridgeIntentInput): Promise<BridgeIntentRecord> {
    const amountSats = assertPositiveIntegerString(input.amountSats, "amountSats");
    const destinationAddress = assertStarknetAddress(input.destinationAddress, "destinationAddress");
    const outputToken = (input.outputToken ?? this.config.atomiqDefaultOutputToken).toUpperCase();
    const source = input.source ?? "BTC";
    if (source !== "BTC" && source !== "BTCLN") throw new Error("source must be BTC or BTCLN");

    const swapper = await this.getSwapper();
    const Tokens = swapper.Tokens ?? swapper.tokens ?? (await this.getFactory()).Tokens;
    const fromToken = source === "BTC" ? Tokens.BITCOIN.BTC : Tokens.BITCOIN.BTCLN;
    const toToken = this.resolveStarknetToken(Tokens, outputToken);
    const gasAmount = BigInt(this.config.atomiqGasDropFri);

    const swap = await swapper.swap(
      fromToken,
      toToken,
      amountSats,
      true,
      undefined,
      destinationAddress,
      gasAmount > 0n ? { gasAmount } : undefined
    );

    const now = new Date().toISOString();
    const id = randomUUID();
    const record: BridgeIntentRecord = {
      id,
      status: "quote_created",
      userId: input.userId,
      farcasterFid: input.farcasterFid,
      source,
      destinationAddress,
      outputToken,
      outputTokenAddress: this.config.tokens[outputToken]?.address,
      inputAmountSats: swap.getInput?.().toString() ?? amountSats.toString(),
      expectedOutputAmount: swap.getOutput?.().toString(),
      feeAmountSats: swap.getFee?.().amountInSrcToken?.toString(),
      paymentAddress: swap.getAddress?.(),
      paymentUri: swap.getHyperlink?.(),
      swapState: stringifySwapState(swap.getState?.()),
      createdAt: now,
      updatedAt: now
    };

    this.runtimeSwaps.set(id, swap);
    return this.store.upsert(record, candidate => candidate.id === id);
  }

  async getIntent(id: string): Promise<BridgeIntentRecord | undefined> {
    const existing = await this.store.find(candidate => candidate.id === id);
    if (!existing) return undefined;
    return this.refreshIntent(existing);
  }

  async listIntents(): Promise<BridgeIntentRecord[]> {
    const intents = await this.store.all();
    return Promise.all(intents.map(intent => this.refreshIntent(intent)));
  }

  private async refreshIntent(record: BridgeIntentRecord): Promise<BridgeIntentRecord> {
    const swap = this.runtimeSwaps.get(record.id);
    if (!swap) return record;

    const swapState = stringifySwapState(swap.getState?.());
    const status = mapSwapStateToIntentStatus(swapState, record.status);
    const updated: BridgeIntentRecord = {
      ...record,
      status,
      swapState,
      updatedAt: new Date().toISOString()
    };

    return this.store.upsert(updated, candidate => candidate.id === record.id);
  }

  private async getFactory(): Promise<any> {
    const [{ SwapperFactory }, { StarknetInitializer }] = await Promise.all([
      import("@atomiqlabs/sdk"),
      import("@atomiqlabs/chain-starknet")
    ]);
    return new SwapperFactory([StarknetInitializer] as const);
  }

  private async getSwapper(): Promise<any> {
    if (!this.swapperPromise) {
      this.swapperPromise = this.buildSwapper();
    }
    return this.swapperPromise;
  }

  private async buildSwapper(): Promise<any> {
    const [{ BitcoinNetwork }, { SqliteStorageManager, SqliteUnifiedStorage }] = await Promise.all([
      import("@atomiqlabs/sdk"),
      import("@atomiqlabs/storage-sqlite")
    ]);
    const factory = await this.getFactory();
    const bitcoinNetwork = this.config.bitcoinNetwork === "mainnet"
      ? BitcoinNetwork.MAINNET
      : this.config.bitcoinNetwork === "testnet4"
        ? BitcoinNetwork.TESTNET4
        : BitcoinNetwork.TESTNET;

    const swapper = factory.newSwapper({
      chains: {
        STARKNET: { rpcUrl: this.config.starknetRpcUrl }
      },
      bitcoinNetwork,
      intermediaryUrl: this.config.atomiqLpUrl || undefined,
      defaultTrustedIntermediaryUrl: this.config.atomiqLpUrl || undefined,
      mempoolApi: this.config.atomiqMempoolApiUrl || undefined,
      getPriceFn: this.config.atomiqPricingApiUrl ? buildCoinGeckoPriceFn(this.config.atomiqPricingApiUrl) : undefined,
      swapStorage: (chainId: string) => new SqliteUnifiedStorage(`${this.config.dataDir}/atomiq-chain-${chainId}.sqlite3`),
      chainStorageCtor: (name: string) => new SqliteStorageManager(`${this.config.dataDir}/atomiq-store-${name}.sqlite3`)
    } as never);
    await swapper.init();
    return swapper.withChain ? swapper.withChain("STARKNET") : swapper;
  }

  private resolveStarknetToken(Tokens: any, symbol: string): any {
    const candidates = [
      Tokens?.STARKNET?.[symbol],
      Tokens?.STARKNET?.[symbol.toLowerCase()],
      Tokens?.STARKNET?.[symbol.toUpperCase()]
    ].filter(Boolean);
    if (candidates.length === 0) {
      throw new Error(`Atomiq Starknet token ${symbol} is not available in SDK token presets`);
    }
    return candidates[0];
  }
}

function buildCoinGeckoPriceFn(baseUrl: string) {
  const ids: Record<string, string> = {
    BTC: "bitcoin",
    WBTC: "wrapped-bitcoin",
    TBTC: "tbtc",
    ETH: "ethereum",
    STRK: "starknet",
    USDC: "usd-coin",
    USDT: "tether"
  };

  return async (tickers: string[], abortSignal?: AbortSignal): Promise<number[]> => {
    const normalized = tickers.map(ticker => ticker.toUpperCase());
    const coingeckoIds = normalized.map(ticker => ids[ticker] ?? ids.WBTC);
    const response = await fetch(
      `${baseUrl}/simple/price?ids=${encodeURIComponent([...new Set(coingeckoIds)].join(","))}&vs_currencies=usd&precision=9`,
      { signal: abortSignal }
    );
    if (!response.ok) {
      throw new Error(`Atomiq pricing API returned HTTP ${response.status}`);
    }
    const payload = await response.json() as Record<string, { usd?: number }>;
    return coingeckoIds.map(id => {
      const usd = payload[id]?.usd;
      if (!Number.isFinite(usd)) throw new Error(`Atomiq pricing API missing ${id}`);
      return Math.round((usd as number) * 100_000_000);
    });
  };
}

function stringifySwapState(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function mapSwapStateToIntentStatus(swapState: string | undefined, fallback: BridgeIntentRecord["status"]): BridgeIntentRecord["status"] {
  if (!swapState) return fallback;
  if (swapState.includes("CLAIM_CLAIMED") || swapState === "3") return "claimed_to_starknet";
  if (swapState.includes("BTC_TX_CONFIRMED") || swapState === "2") return "btc_confirmed";
  if (swapState.includes("CLAIM_COMMITED") || swapState === "1") return "payment_detected";
  if (swapState.includes("EXPIRED") || swapState === "-3" || swapState === "-2") return "expired";
  return fallback;
}
