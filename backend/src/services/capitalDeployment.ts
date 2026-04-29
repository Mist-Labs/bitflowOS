import { createHash } from "node:crypto";
import { Account, RpcProvider } from "starknet";
import type { AppConfig } from "../config.js";
import type { AllocationRecommendation, StarknetCall, StrategyRouteConfig } from "../types.js";
import { AlertService } from "./alerts.js";

const STARKNET_FIELD_PRIME = BigInt("0x800000000000011000000000000000000000000000000000000000000000001");

export type CapitalDeploymentResult = {
  status: "submitted" | "skipped";
  transactionHash?: string;
  attestationHash?: string;
  weights: Array<{
    strategyId: string;
    asset: string;
    targetBps: number;
    label: string;
  }>;
  skippedWeights?: Array<{
    strategyId: string;
    targetBps: number;
    label: string;
    reason: string;
  }>;
  calls: StarknetCall[];
  message: string;
};

export class CapitalDeploymentService {
  private readonly alerts: AlertService;

  constructor(private readonly config: AppConfig) {
    this.alerts = new AlertService(config);
  }

  async deploy(input: { recommendation: AllocationRecommendation }): Promise<CapitalDeploymentResult> {
    const recommendation = input.recommendation;
    if (recommendation.status !== "ready") {
      throw new Error("Kimi recommendation is not ready for deployment.");
    }
    if (!recommendation.attestation.verified) {
      throw new Error("0G verification is required before capital deployment.");
    }
    if (!this.config.starknetAccountAddress || !this.config.starknetPrivateKey) {
      throw new Error("Capital deployment executor is not configured. Set STARKNET_ACCOUNT_ADDRESS and STARKNET_PRIVATE_KEY for the backend executor account.");
    }
    if (!this.config.bitflowosAttestationRegistryAddress || !this.config.bitflowosStrategyRouterAddress) {
      throw new Error("Attestation registry and strategy router addresses are required for deployment.");
    }

    const plan = this.toExecutablePlan(recommendation);
    const weights = plan.weights;
    if (!weights.length) {
      return {
        status: "skipped",
        attestationHash: recommendation.attestation.attestationHash,
        weights: [],
        skippedWeights: plan.skippedWeights,
        calls: [],
        message: plan.skippedWeights.length
          ? `No router transaction was submitted because every non-idle route is currently gated: ${plan.skippedWeights.map(item => `${item.label} (${item.reason})`).join(", ")}.`
          : "Recommendation is fully idle or has no executable configured route, so no router transaction was submitted."
      };
    }

    const attestationHash = toFelt(recommendation.attestation.attestationHash ?? hashJson(recommendation));
    const inputHash = toFelt(hashJson({
      walletAddress: recommendation.walletAddress,
      assetSymbol: recommendation.assetSymbol,
      createdAt: recommendation.createdAt
    }));
    const outputHash = toFelt(hashJson(recommendation.weights));
    const quoteHash = toFelt(hashJson({
      provider: recommendation.attestation.provider,
      providerAddress: recommendation.attestation.providerAddress,
      confidenceBps: recommendation.confidenceBps
    }));
    const expiry = Math.floor(Date.now() / 1000) + 30 * 60;

    const calls: StarknetCall[] = [
      {
        contractAddress: this.config.bitflowosAttestationRegistryAddress,
        entrypoint: "submit_attestation",
        calldata: [attestationHash, inputHash, outputHash, quoteHash, String(expiry)]
      },
      {
        contractAddress: this.config.bitflowosStrategyRouterAddress,
        entrypoint: "rebalance",
        calldata: [
          String(weights.length),
          ...weights.flatMap(weight => [weight.strategyId, weight.asset, String(weight.targetBps)]),
          attestationHash
        ]
      }
    ];

    const provider = new RpcProvider({ nodeUrl: this.config.starknetRpcUrl });
    const account = new Account({
      provider,
      address: this.config.starknetAccountAddress,
      signer: this.config.starknetPrivateKey
    });
    const execution = await account.execute(calls.map(call => ({
      contractAddress: call.contractAddress,
      entrypoint: call.entrypoint,
      calldata: call.calldata
    })));
    if (recommendation.walletAddress) {
      await this.alerts.send({
        walletAddress: recommendation.walletAddress,
        type: "staking_started",
        title: "Capital deployment submitted",
        body: `BitflowOS routed capital to ${weights.map(item => `${item.label} ${Math.round(item.targetBps / 100)}%`).join(", ")}.`,
        targetUrl: this.config.farcasterAppUrl,
        transactionHash: execution.transaction_hash
      });
    }

    return {
      status: "submitted",
      transactionHash: execution.transaction_hash,
      attestationHash,
      weights,
      skippedWeights: plan.skippedWeights,
      calls,
      message: plan.skippedWeights.length
        ? `Capital deployment submitted to the strategy router. Gated routes stayed idle: ${plan.skippedWeights.map(item => item.label).join(", ")}.`
        : "Capital deployment submitted to the strategy router."
    };
  }

  private toExecutablePlan(recommendation: AllocationRecommendation) {
    const skippedWeights: NonNullable<CapitalDeploymentResult["skippedWeights"]> = [];
    const weights = recommendation.weights.flatMap(weight => {
      if (isIdleAllocation(weight.strategyId, weight.label) || weight.targetBps <= 0) return [];
      const route = this.findRoute(weight.strategyId, weight.label);
      if (!route.executionEnabled) {
        throw new Error(`${route.label} is not enabled for on-chain execution.`);
      }
      const gateReason = getExecutionGateReason(route);
      if (gateReason) {
        skippedWeights.push({
          strategyId: route.id,
          targetBps: weight.targetBps,
          label: route.label,
          reason: gateReason
        });
        return [];
      }
      if (weight.targetBps > route.maxBps) {
        throw new Error(`${route.label} target ${weight.targetBps} bps exceeds route cap ${route.maxBps} bps.`);
      }
      const token = this.config.tokens[route.assetSymbol.toUpperCase()];
      if (!token?.enabled) {
        throw new Error(`${route.assetSymbol} is not enabled for deployment.`);
      }
      return [{
        strategyId: route.id,
        asset: token.address,
        targetBps: weight.targetBps,
        label: route.label
      }];
    });
    return { weights, skippedWeights };
  }

  private toExecutableWeights(recommendation: AllocationRecommendation) {
    return this.toExecutablePlan(recommendation).weights;
  }

  private findRoute(strategyId: string, label: string): StrategyRouteConfig {
    const normalizedId = normalizeFeltish(strategyId);
    const route = Object.values(this.config.strategyRoutes).find(item => (
      normalizeFeltish(item.id) === normalizedId
      || item.label.toLowerCase() === label.toLowerCase()
      || item.label.toLowerCase() === strategyId.toLowerCase()
    ));
    if (!route) {
      throw new Error(`No executable route is configured for ${label || strategyId}.`);
    }
    if (!route.enabled) {
      throw new Error(`${route.label} is not enabled.`);
    }
    return route;
  }
}

export function getExecutionGateReason(route: StrategyRouteConfig): string | undefined {
  if (route.quoteRequired) {
    return "route requires a live quote and slippage preflight";
  }
  if (route.uiEnabled === false) {
    return route.disabledReason ?? "route is currently gated";
  }
  return undefined;
}

function hashJson(value: unknown) {
  return `0x${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function toFelt(value: string) {
  const raw = BigInt(value);
  const felt = raw % STARKNET_FIELD_PRIME;
  return `0x${felt.toString(16)}`;
}

function normalizeFeltish(value: string) {
  const trimmed = value.trim();
  try {
    return `0x${BigInt(trimmed).toString(16)}`;
  } catch {
    if (/^[a-zA-Z0-9_ -]{2,32}$/.test(trimmed)) {
      return `0x${Buffer.from(trimmed, "utf8").toString("hex")}`;
    }
    return trimmed.toLowerCase();
  }
}

export function isIdleAllocation(strategyId: string, label = "") {
  const normalized = `${normalizeText(strategyId)} ${normalizeText(label)}`;
  return /\bidle\b/.test(normalized)
    || /\breserve\b/.test(normalized)
    || /\bcash\b/.test(normalized)
    || /\bunallocated\b/.test(normalized)
    || /\bwithdrawal buffer\b/.test(normalized)
    || /\bliquid buffer\b/.test(normalized);
}

function normalizeText(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}
