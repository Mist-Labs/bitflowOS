import { describe, expect, it } from "vitest";
import { CapitalDeploymentService, getExecutionGateReason, isIdleAllocation } from "../src/services/capitalDeployment.js";
import { loadConfig } from "../src/config.js";
import type { AllocationRecommendation } from "../src/types.js";

describe("allocation normalization", () => {
  it("treats reserve variants as idle allocations", () => {
    expect(isIdleAllocation("IDLE", "Idle Reserve")).toBe(true);
    expect(isIdleAllocation("RESERVE", "RESERVE")).toBe(true);
    expect(isIdleAllocation("CASH", "Cash Reserve")).toBe(true);
    expect(isIdleAllocation("UNALLOCATED", "Vault reserve")).toBe(true);
    expect(isIdleAllocation("WITHDRAWAL_BUFFER", "Withdrawal buffer")).toBe(true);
    expect(isIdleAllocation("LIQUID_BUFFER", "Liquid buffer")).toBe(true);
  });

  it("does not classify BTC liquidity strategy labels as idle reserve", () => {
    expect(isIdleAllocation("0x454b4232", "BTC Liquidity")).toBe(false);
    expect(isIdleAllocation("EKUBO", "Ekubo Controlled sBTC Test Route")).toBe(false);
  });

  it("skips reserve weights and resolves ascii strategy ids to felt routes", () => {
    const config = loadConfig({
      STARKNET_RPC_URL: "https://starknet-mainnet.public.blastapi.io/rpc/v0_7",
      STARKNET_ACCOUNT_ADDRESS: "0x123",
      STARKNET_PRIVATE_KEY: "0x456",
      BITFLOWOS_VAULT_ADDRESS: "0x789",
      BITFLOWOS_ATTESTATION_REGISTRY_ADDRESS: "0xabc",
      BITFLOWOS_STRATEGY_ROUTER_ADDRESS: "0xdef",
      SUPPORTED_TOKENS_JSON: JSON.stringify({
        SBTC_TEST: {
          symbol: "SBTC_TEST",
          address: "0x111",
          decimals: 18,
          enabled: true
        }
      }),
      STRATEGY_ROUTES_JSON: JSON.stringify({
        ERC4626: {
          id: "0x45524334363236",
          label: "Sepolia ERC4626 Test Route",
          adapterAddress: "0x222",
          maxBps: 7000,
          assetSymbol: "SBTC_TEST",
          enabled: true,
          kind: "erc4626",
          executionEnabled: true
        }
      })
    });
    const service = new CapitalDeploymentService(config) as unknown as {
      toExecutableWeights(recommendation: AllocationRecommendation): Array<{ strategyId: string; targetBps: number }>;
    };
    const weights = service.toExecutableWeights({
      id: "test",
      assetSymbol: "SBTC_TEST",
      status: "ready",
      confidenceBps: 7000,
      weights: [
        { strategyId: "ERC4626", label: "Sepolia ERC4626 Test Route", targetBps: 6000, rationale: "route" },
        { strategyId: "RESERVE", label: "RESERVE", targetBps: 4000, rationale: "idle" }
      ],
      riskChecks: [],
      reasoning: "test",
      attestation: {
        provider: "0g",
        verified: true,
        verificationMode: "0g"
      },
      createdAt: new Date().toISOString()
    });

    expect(weights).toEqual([
      expect.objectContaining({ strategyId: "0x45524334363236", targetBps: 6000 })
    ]);
  });

  it("gates quote-required routes before Starknet fee estimation", async () => {
    const config = loadConfig({
      STARKNET_RPC_URL: "https://starknet-mainnet.public.blastapi.io/rpc/v0_7",
      STARKNET_ACCOUNT_ADDRESS: "0x123",
      STARKNET_PRIVATE_KEY: "0x456",
      BITFLOWOS_VAULT_ADDRESS: "0x789",
      BITFLOWOS_ATTESTATION_REGISTRY_ADDRESS: "0xabc",
      BITFLOWOS_STRATEGY_ROUTER_ADDRESS: "0xdef",
      SUPPORTED_TOKENS_JSON: JSON.stringify({
        SBTC_TEST: {
          symbol: "SBTC_TEST",
          address: "0x111",
          decimals: 18,
          enabled: true
        }
      }),
      STRATEGY_ROUTES_JSON: JSON.stringify({
        EKUBO: {
          id: "0x454b4232",
          label: "Ekubo Controlled sBTC Test Route",
          adapterAddress: "0x222",
          maxBps: 1500,
          assetSymbol: "SBTC_TEST",
          enabled: true,
          kind: "ekubo",
          executionEnabled: true,
          quoteRequired: true,
          uiEnabled: false
        }
      })
    });
    const service = new CapitalDeploymentService(config);
    const recommendation: AllocationRecommendation = {
      id: "test",
      assetSymbol: "SBTC_TEST",
      status: "ready",
      confidenceBps: 7000,
      weights: [
        { strategyId: "EKB2", label: "Ekubo Controlled sBTC Test Route", targetBps: 1200, rationale: "route" },
        { strategyId: "IDLE", label: "Idle Reserve", targetBps: 8800, rationale: "idle" }
      ],
      riskChecks: [],
      reasoning: "test",
      attestation: {
        provider: "0g",
        verified: true,
        verificationMode: "0g"
      },
      createdAt: new Date().toISOString()
    };

    const result = await service.deploy({ recommendation });

    expect(result.status).toBe("skipped");
    expect(result.calls).toEqual([]);
    expect(result.skippedWeights).toEqual([
      expect.objectContaining({
        label: "Ekubo Controlled sBTC Test Route",
        reason: "route requires a live quote and slippage preflight"
      })
    ]);
  });

  it("explains why quote-required routes are gated", () => {
    expect(getExecutionGateReason({
      id: "0x1",
      label: "Ekubo",
      adapterAddress: "0x2",
      maxBps: 1000,
      assetSymbol: "SBTC_TEST",
      enabled: true,
      kind: "ekubo",
      executionEnabled: true,
      quoteRequired: true
    })).toBe("route requires a live quote and slippage preflight");
  });
});
