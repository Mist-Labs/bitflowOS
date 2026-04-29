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

    const weights = this.toExecutableWeights(recommendation);
    if (!weights.length) {
      return {
        status: "skipped",
        attestationHash: recommendation.attestation.attestationHash,
        weights: [],
        calls: [],
        message: "Recommendation is fully idle or has no executable configured route, so no router transaction was submitted."
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
      calls,
      message: "Capital deployment submitted to the strategy router."
    };
  }

  private toExecutableWeights(recommendation: AllocationRecommendation) {
    return recommendation.weights.flatMap(weight => {
      if (/idle/i.test(weight.strategyId) || /idle/i.test(weight.label) || weight.targetBps <= 0) return [];
      const route = this.findRoute(weight.strategyId, weight.label);
      if (!route.executionEnabled) {
        throw new Error(`${route.label} is not enabled for on-chain execution.`);
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

function hashJson(value: unknown) {
  return `0x${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function toFelt(value: string) {
  const raw = BigInt(value);
  const felt = raw % STARKNET_FIELD_PRIME;
  return `0x${felt.toString(16)}`;
}

function normalizeFeltish(value: string) {
  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return value.toLowerCase();
  }
}
