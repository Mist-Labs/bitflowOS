import { createHash, randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { AllocationRecommendation } from "../types.js";
import { ZeroGVerifierService } from "./zeroGVerifier.js";
import { getExecutionGateReason, isIdleAllocation } from "./capitalDeployment.js";

type RecommendationInput = {
  walletAddress?: string;
  assetSymbol?: string;
  amountBaseUnits?: string;
};

export class KimiRecommendationService {
  private readonly verifier: ZeroGVerifierService;

  constructor(private readonly config: AppConfig) {
    this.verifier = new ZeroGVerifierService(config);
  }

  getStatus() {
    return {
      kimi: {
        configured: Boolean(this.config.kimiApiKey),
        model: this.config.kimiModel,
        baseUrl: this.config.kimiApiBaseUrl
      },
      tee: {
        provider: this.config.teeProvider,
        verifier: this.verifier.getStatus()
      },
      policy: this.config.policy
    };
  }

  async recommend(input: RecommendationInput): Promise<AllocationRecommendation> {
    const assetSymbol = (input.assetSymbol ?? Object.values(this.config.tokens)[0]?.symbol ?? "WBTC").toUpperCase();
    const now = new Date().toISOString();
    const baseRecommendation = this.buildPolicyBoundFallback(input, assetSymbol, now);

    if (!this.config.kimiApiKey) {
      return {
        ...baseRecommendation,
        status: "fallback",
        reasoning: "Kimi is not configured. Set `KIMI_API_KEY` and `KIMI_MODEL` to enable live recommendations."
      };
    }

    try {
      const modelRecommendation = await this.callKimi(input, assetSymbol);
      const recommendation = this.normalizeRecommendation(modelRecommendation, baseRecommendation);
      const attestation = await this.verifier.verifyProvider();
      return {
        ...recommendation,
        attestation: {
          provider: "0g",
          verified: attestation.verified,
          verificationMode: attestation.configured ? "0g" : "not_configured",
          providerAddress: attestation.providerAddress,
          attestationHash: hashRecommendation(recommendation),
          setupRequired: attestation.setupRequired
        }
      };
    } catch (error) {
      return {
        ...baseRecommendation,
        status: "fallback",
        reasoning: `Kimi call failed, so BitflowOS prepared a conservative policy fallback: ${(error as Error).message}`
      };
    }
  }

  private async callKimi(input: RecommendationInput, assetSymbol: string): Promise<unknown> {
    const response = await fetch(`${this.config.kimiApiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.kimiApiKey}`
      },
      body: JSON.stringify({
        model: this.config.kimiModel,
        max_tokens: 4096,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are BitflowOS policy-bound allocation agent.",
              "Return strict JSON with confidenceBps, weights, riskChecks, and reasoning.",
              "Each weight must use camelCase fields: strategyId, label, targetBps, rationale. targetBps is an integer basis-point value.",
              "Use only configured strategy ids from the user payload. For idle/reserve/cash/liquid buffer, always use strategyId `IDLE` and label `Idle Reserve`.",
              "Never recommend fake APYs. Prefer idle reserve when live data is incomplete.",
              `Policy: min confidence ${this.config.policy.minConfidenceBps}, min idle ${this.config.policy.minIdleReserveBps}, max LP ${this.config.policy.maxLpBps}, max strategy ${this.config.policy.maxStrategyBps}.`
            ].join(" ")
          },
          {
            role: "user",
            content: JSON.stringify({
              assetSymbol,
              amountBaseUnits: input.amountBaseUnits,
              walletAddress: input.walletAddress,
              strategies: this.getRecommendationRoutes(),
              tokens: Object.values(this.config.tokens)
            })
          }
        ]
      })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Kimi returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Kimi response did not include content");
    return JSON.parse(content);
  }

  private normalizeRecommendation(raw: unknown, fallback: AllocationRecommendation): AllocationRecommendation {
    const candidate = raw as Partial<AllocationRecommendation>;
    const candidateWeights = Array.isArray(candidate.weights) && candidate.weights.length > 0
      ? candidate.weights.map((item: any) => {
        const rawStrategyId = String(item.strategyId ?? item.id ?? item.label ?? "IDLE");
        const rawLabel = String(item.label ?? rawStrategyId);
        const idle = isIdleAllocation(rawStrategyId, rawLabel);
        const strategyId = idle ? "IDLE" : rawStrategyId;
        return {
          strategyId,
          label: idle ? "Idle Reserve" : this.resolveStrategyLabel(strategyId, rawLabel),
          targetBps: clampBps(Number(
            item.targetBps
              ?? item.target_bps
              ?? item.targetWeightBps
              ?? item.target_weight_bps
              ?? item.weightBps
              ?? item.weight_bps
              ?? item.bps
              ?? (Number.isFinite(Number(item.percent)) ? Number(item.percent) * 100 : 0)
          )),
          rationale: String(item.rationale ?? "Policy checked.")
        };
      })
      : fallback.weights;
    const weights = this.withIdleReserve(candidateWeights);
    const idleBps = weights
      .filter(item => isIdleAllocation(item.strategyId, item.label))
      .reduce((sum, item) => sum + item.targetBps, 0);
    const maxStrategyBps = Math.max(...weights
      .filter(item => !isIdleAllocation(item.strategyId, item.label))
      .map(item => item.targetBps), 0);
    const confidenceBps = clampBps(Number(candidate.confidenceBps ?? fallback.confidenceBps));

    return {
      ...fallback,
      status: confidenceBps >= this.config.policy.minConfidenceBps ? "ready" : "blocked",
      confidenceBps,
      weights,
      riskChecks: [
        {
          id: "confidence",
          label: "Confidence threshold",
          passed: confidenceBps >= this.config.policy.minConfidenceBps,
          detail: `Minimum ${this.config.policy.minConfidenceBps} bps.`
        },
        {
          id: "idle-reserve",
          label: "Idle reserve",
          passed: idleBps >= this.config.policy.minIdleReserveBps,
          detail: `Idle target ${idleBps} bps.`
        },
        {
          id: "strategy-cap",
          label: "Strategy cap",
          passed: maxStrategyBps <= this.config.policy.maxStrategyBps,
          detail: `Largest strategy target ${maxStrategyBps} bps.`
        }
      ],
      reasoning: String(candidate.reasoning ?? fallback.reasoning)
    };
  }

  private resolveStrategyLabel(strategyId: string, fallbackLabel = strategyId): string {
    if (isIdleAllocation(strategyId, fallbackLabel)) return "Idle Reserve";
    const normalizedId = normalizeFeltish(strategyId);
    const route = Object.values(this.config.strategyRoutes).find(item => (
      normalizeFeltish(item.id) === normalizedId
      || item.label.toLowerCase() === strategyId.toLowerCase()
      || item.label.toLowerCase() === fallbackLabel.toLowerCase()
    ));
    return route?.label ?? fallbackLabel;
  }

  private withIdleReserve(weights: AllocationRecommendation["weights"]): AllocationRecommendation["weights"] {
    const totalBps = weights.reduce((sum, item) => sum + item.targetBps, 0);
    const missingBps = Math.max(0, 10000 - totalBps);
    const idleIndex = weights.findIndex(item => isIdleAllocation(item.strategyId, item.label));

    if (idleIndex >= 0) {
      return weights.map((item, index) => index === idleIndex
        ? { ...item, targetBps: clampBps(item.targetBps + missingBps) }
        : item
      );
    }

    if (missingBps === 0) return weights;
    return [
      ...weights,
      {
        strategyId: "IDLE",
        label: "Idle Reserve",
        targetBps: missingBps,
        rationale: "Remainder held liquid by policy for withdrawals and rebalancing."
      }
    ];
  }

  private buildPolicyBoundFallback(input: RecommendationInput, assetSymbol: string, createdAt: string): AllocationRecommendation {
    const routes = this.getRecommendationRoutes();
    const primary = routes[0];
    const primaryBps = primary ? Math.min(4000, primary.maxBps, this.config.policy.maxStrategyBps) : 0;
    const idleBps = 10000 - primaryBps;
    return {
      id: randomUUID(),
      walletAddress: input.walletAddress,
      assetSymbol,
      status: "ready",
      confidenceBps: this.config.policy.minConfidenceBps,
      weights: [
        ...(primary ? [{
          strategyId: primary.id,
          label: primary.label,
          targetBps: primaryBps,
          rationale: "First enabled route with conservative cap until live APR feeds are complete."
        }] : []),
        {
          strategyId: "IDLE",
          label: "Idle Reserve",
          targetBps: idleBps,
          rationale: "Keeps withdrawals and rebalance flexibility available."
        }
      ],
      riskChecks: [
        {
          id: "live-data",
          label: "Live data",
          passed: routes.length > 0,
          detail: routes.length > 0 ? "At least one route is enabled." : "No route is enabled; stay idle."
        },
        {
          id: "lp-cap",
          label: "LP exposure cap",
          passed: true,
          detail: "Ekubo LP exposure remains gated unless quote checks are enabled."
        }
      ],
      reasoning: "Conservative policy allocation prepared from configured routes.",
      attestation: {
        provider: "0g",
        verified: false,
        verificationMode: "not_configured",
        setupRequired: this.verifier.getStatus().setupRequired
      },
      createdAt
    };
  }

  private getRecommendationRoutes() {
    return Object.values(this.config.strategyRoutes)
      .filter(route => route.enabled && route.executionEnabled && !getExecutionGateReason(route));
  }
}

function clampBps(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10000, Math.round(value)));
}

function hashRecommendation(recommendation: AllocationRecommendation): string {
  return `0x${createHash("sha256").update(JSON.stringify({
    id: recommendation.id,
    weights: recommendation.weights,
    riskChecks: recommendation.riskChecks,
    createdAt: recommendation.createdAt
  })).digest("hex")}`;
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
