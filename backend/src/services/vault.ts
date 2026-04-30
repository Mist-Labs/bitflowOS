import type { AppConfig } from "../config.js";
import {
  buildRouterHarvestCall,
  buildRouterReadCalls,
  buildYieldVaultDepositCalls,
  buildYieldVaultWithdrawCall,
  parseFelt,
  parseU256,
  starknetCall
} from "../lib/starknet.js";
import type { StarknetCall } from "../types.js";

const ZERO_U256 = ["0x0", "0x0"];

/** Wraps starknetCall — returns a zero fallback instead of throwing. */
async function safeCall(
  args: Parameters<typeof starknetCall>[0],
  fallback: string[] = ZERO_U256
): Promise<string[]> {
  try {
    return await starknetCall(args);
  } catch (err) {
    console.warn(
      `[VaultService] safeCall failed ${args.contractAddress} ${args.entrypoint}:`,
      (err as Error).message
    );
    return fallback;
  }
}

export class VaultService {
  constructor(private readonly config: AppConfig) {}

  buildDepositCalls(input: { tokenSymbol: string; amountBaseUnits: string }): {
    tokenAddress: string;
    vaultAddress: string;
    calls: StarknetCall[];
  } {
    const token = this.getEnabledToken(input.tokenSymbol);
    const calls = buildYieldVaultDepositCalls({
      tokenAddress: token.address,
      vaultAddress: this.config.bitflowosVaultAddress,
      amountBaseUnits: input.amountBaseUnits,
    });
    return {
      tokenAddress: token.address,
      vaultAddress: this.config.bitflowosVaultAddress,
      calls
    };
  }

  buildWithdrawCall(input: { tokenSymbol: string; sharesBaseUnits: string }): {
    tokenAddress: string;
    vaultAddress: string;
    call: StarknetCall;
  } {
    const token = this.getEnabledToken(input.tokenSymbol);
    return {
      tokenAddress: token.address,
      vaultAddress: this.config.bitflowosVaultAddress,
      call: buildYieldVaultWithdrawCall({
        tokenAddress: token.address,
        vaultAddress: this.config.bitflowosVaultAddress,
        sharesBaseUnits: input.sharesBaseUnits
      })
    };
  }

  buildRouterReadCalls(input: { tokenSymbol: string; strategyId: string }): {
    tokenAddress: string;
    routerAddress: string;
    calls: StarknetCall[];
  } {
    const token = this.getEnabledToken(input.tokenSymbol);
    if (!this.config.bitflowosStrategyRouterAddress) {
      throw new Error("strategy router address is not configured");
    }
    return {
      tokenAddress: token.address,
      routerAddress: this.config.bitflowosStrategyRouterAddress,
      calls: buildRouterReadCalls({
        routerAddress: this.config.bitflowosStrategyRouterAddress,
        tokenAddress: token.address,
        strategyId: input.strategyId
      })
    };
  }

  buildRouterHarvestCall(input: { tokenSymbol: string; strategyId: string }): {
    tokenAddress: string;
    routerAddress: string;
    call: StarknetCall;
  } {
    const token = this.getEnabledToken(input.tokenSymbol);
    if (!this.config.bitflowosStrategyRouterAddress) {
      throw new Error("strategy router address is not configured");
    }
    return {
      tokenAddress: token.address,
      routerAddress: this.config.bitflowosStrategyRouterAddress,
      call: buildRouterHarvestCall({
        routerAddress: this.config.bitflowosStrategyRouterAddress,
        tokenAddress: token.address,
        strategyId: input.strategyId
      })
    };
  }

  async getVaultState(userAddress?: string): Promise<unknown> {
    const tokens = Object.values(this.config.tokens).filter(t => t.enabled);
    const routes = Object.values(this.config.strategyRoutes).filter(r => r.enabled);

    // Normalize address to avoid felt comparison mismatches
    const normalizedUser = userAddress ? normalizeFelt(userAddress) : undefined;

    const assetStates = await Promise.all(
      tokens.map(async token => {
        const [
          totalAssetsRaw,
          supportedRaw,
          userSharesRaw,
          userAssetSharesRaw,
          tokenBalanceRaw
        ] = await Promise.all([
          safeCall({
            rpcUrl: this.config.starknetRpcUrl,
            contractAddress: this.config.bitflowosVaultAddress,
            entrypoint: "total_assets",
            calldata: [token.address]
          }),
          safeCall({
            rpcUrl: this.config.starknetRpcUrl,
            contractAddress: this.config.bitflowosVaultAddress,
            entrypoint: "is_supported_asset",
            calldata: [token.address]
          }, ["0x0"]),
          normalizedUser
            ? safeCall({
                rpcUrl: this.config.starknetRpcUrl,
                contractAddress: this.config.bitflowosVaultAddress,
                entrypoint: "get_user_position",
                calldata: [normalizedUser]
              })
            : Promise.resolve(ZERO_U256),
          normalizedUser
            ? safeCall({
                rpcUrl: this.config.starknetRpcUrl,
                contractAddress: this.config.bitflowosVaultAddress,
                entrypoint: "get_user_asset_position",
                calldata: [normalizedUser, token.address]
              })
            : Promise.resolve(ZERO_U256),
          normalizedUser
            ? safeCall({
                rpcUrl: this.config.starknetRpcUrl,
                contractAddress: token.address,
                entrypoint: "balance_of",
                calldata: [normalizedUser]
              })
            : Promise.resolve(ZERO_U256)
        ]);

        const userShares      = parseU256(userSharesRaw);
        const userAssetShares = parseU256(userAssetSharesRaw);
        const walletBalance   = parseU256(tokenBalanceRaw);

        if (normalizedUser) {
          console.log(
            `[VaultService] ${token.symbol} ` +
            `userShares=${userShares} userAssetShares=${userAssetShares} ` +
            `walletBalance=${walletBalance}`
          );
        }

        return {
          symbol:            token.symbol,
          address:           token.address,
          decimals:          token.decimals,
          kind:              token.kind,
          supported:         parseFelt(supportedRaw) !== "0x0",
          totalAssets:       parseU256(totalAssetsRaw),
          userShares,
          userAssetShares,
          userWalletBalance: walletBalance
        };
      })
    );

    const strategyStates = await Promise.all(
      routes.map(async route => {
        const token = this.config.tokens[route.assetSymbol];
        if (!token || !this.config.bitflowosStrategyRouterAddress) {
          return { ...route, configured: false };
        }

        const [adapterRaw, positionRaw, adapterPositionRaw] = await Promise.all([
          safeCall({
            rpcUrl: this.config.starknetRpcUrl,
            contractAddress: this.config.bitflowosStrategyRouterAddress,
            entrypoint: "get_strategy_adapter",
            calldata: [route.id]
          }, ["0x0"]),
          safeCall({
            rpcUrl: this.config.starknetRpcUrl,
            contractAddress: this.config.bitflowosStrategyRouterAddress,
            entrypoint: "get_strategy_position",
            calldata: [route.id, token.address]
          }),
          safeCall({
            rpcUrl: this.config.starknetRpcUrl,
            contractAddress: route.adapterAddress,
            entrypoint: "total_position",
            calldata: [token.address]
          })
        ]);

        return {
          ...route,
          configured:
            normalizeFelt(parseFelt(adapterRaw)) ===
            normalizeFelt(route.adapterAddress),
          routerPosition:  parseU256(positionRaw),
          adapterPosition: parseU256(adapterPositionRaw)
        };
      })
    );

    return {
      network:   this.config.starknetNetwork,
      rpcUrl:    this.config.starknetRpcUrl,
      contracts: {
        vault:               this.config.bitflowosVaultAddress,
        router:              this.config.bitflowosStrategyRouterAddress,
        attestationRegistry: this.config.bitflowosAttestationRegistryAddress,
        erc4626Adapter:      this.config.bitflowosErc4626AdapterAddress,
        leveragedVaultAdapter: this.config.bitflowosLeveragedVaultAdapterAddress,
        ekuboAdapter:        this.config.bitflowosEkuboAdapterAddress
      },
      assets:     assetStates,
      strategies: strategyStates
    };
  }

  private getEnabledToken(symbolInput: string) {
    const symbol = symbolInput.toUpperCase();
    const token = this.config.tokens[symbol];
    if (!token || !token.enabled) {
      throw new Error(`token ${symbol} is not enabled for BitflowOS deposits`);
    }
    return token;
  }
}

function normalizeFelt(value: string): string {
  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return value;
  }
}