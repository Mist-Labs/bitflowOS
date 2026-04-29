import type { AppConfig } from "../config.js";
import type { EkuboPoolRouteConfig, StrategyRouteConfig } from "../types.js";

type EkuboPoolApiResponse = {
  topPools?: Array<{
    pool_id: string;
    fee: string;
    tick_spacing: number;
    core_address: string;
    extension: string;
    volume0_24h: string;
    volume1_24h: string;
    fees0_24h: string;
    fees1_24h: string;
    tvl0_total: string;
    tvl1_total: string;
    depth0: string;
    depth1: string;
    depth_percent: number | null;
  }>;
};

export class EkuboService {
  constructor(private readonly config: AppConfig) {}

  async getRouteQuote(input: {
    routeKey?: string;
    tokenSymbol?: string;
    amountBaseUnits?: string;
  }) {
    const route = this.getEkuboRoute(input.routeKey, input.tokenSymbol);
    const pool = route.pool;

    if (!pool) {
      return {
        route,
        ready: false,
        executable: false,
        reason: "Ekubo pool config is not set for this route."
      };
    }

    const livePool = await this.fetchConfiguredPool(pool);
    const ready = Boolean(livePool);
    const executable = Boolean(route.enabled && route.executionEnabled && route.uiEnabled && ready);

    return {
      route: {
        id: route.id,
        label: route.label,
        assetSymbol: route.assetSymbol,
        maxBps: route.maxBps,
        enabled: route.enabled,
        uiEnabled: route.uiEnabled ?? false,
        executionEnabled: route.executionEnabled ?? false,
        disabledReason: route.disabledReason
      },
      ready,
      executable,
      reason: executable
        ? "Ekubo route is configured and execution is enabled."
        : route.disabledReason ?? "Ekubo execution is gated until the fixed route is funded and slippage checks are finalized.",
      inputAmountBaseUnits: input.amountBaseUnits,
      pool,
      livePool,
      adapterAdminPlan: {
        configurePosition: {
          asset: this.getRouteAssetAddress(route),
          positions: pool.positionsAddress,
          token0: pool.token0,
          token1: pool.token1,
          fee: pool.fee,
          tickSpacing: pool.tickSpacing,
          extension: pool.extension,
          lowerTick: pool.lowerTick,
          upperTick: pool.upperTick,
          assetIsToken1: pool.assetIsToken1
        },
        setSlippageLimits: {
          minLiquidity: pool.minLiquidity,
          minWithdrawToken0: pool.minWithdrawToken0,
          minWithdrawToken1: pool.minWithdrawToken1
        }
      }
    };
  }

  private getEkuboRoute(routeKey?: string, tokenSymbol?: string): StrategyRouteConfig {
    const routes = Object.entries(this.config.strategyRoutes);
    const matched = routes.find(([key, route]) => {
      if (route.kind !== "ekubo") return false;
      if (routeKey && key !== routeKey.toUpperCase() && route.id.toUpperCase() !== routeKey.toUpperCase()) {
        return false;
      }
      if (tokenSymbol && route.assetSymbol !== tokenSymbol.toUpperCase()) {
        return false;
      }
      return true;
    });

    if (!matched) {
      throw new Error("Ekubo route is not configured");
    }
    return matched[1];
  }

  private getRouteAssetAddress(route: StrategyRouteConfig): string {
    const token = this.config.tokens[route.assetSymbol];
    if (!token) {
      throw new Error(`token ${route.assetSymbol} is not configured`);
    }
    return token.address;
  }

  private async fetchConfiguredPool(pool: EkuboPoolRouteConfig) {
    const apiUrl = (pool.apiUrl || this.config.ekuboApiUrl).replace(/\/$/, "");
    const url = new URL(`${apiUrl}/pair/${pool.chainId}/${pool.token0}/${pool.token1}/pools`);
    url.searchParams.set("minTvlUsd", "0");

    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = await response.json() as EkuboPoolApiResponse;
    return data.topPools?.find(candidate => {
      if (pool.poolId && candidate.pool_id !== pool.poolId) return false;
      return (
        candidate.fee === pool.fee &&
        candidate.tick_spacing === pool.tickSpacing &&
        normalizeAddress(candidate.core_address) === normalizeAddress(pool.coreAddress) &&
        normalizeAddress(candidate.extension) === normalizeAddress(pool.extension)
      );
    }) ?? null;
  }
}

function normalizeAddress(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}
