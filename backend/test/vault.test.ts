import { describe, expect, it } from "vitest";
import {
  buildRouterReadCalls,
  buildYieldVaultDepositCalls,
  buildYieldVaultWithdrawCall
} from "../src/lib/starknet.js";

describe("vault transaction builder", () => {
  it("builds approve and deposit calls in the correct order", () => {
    const calls = buildYieldVaultDepositCalls({
      tokenAddress: "0x123",
      vaultAddress: "0x456",
      amountBaseUnits: "100000000"
    });

    expect(calls).toEqual([
      {
        contractAddress: "0x123",
        entrypoint: "approve",
        calldata: ["0x456", "100000000", "0"]
      },
      {
        contractAddress: "0x456",
        entrypoint: "deposit",
        calldata: ["0x123", "100000000", "0"]
      }
    ]);
  });

  it("rejects invalid Starknet addresses", () => {
    expect(() => buildYieldVaultDepositCalls({
      tokenAddress: "not-an-address",
      vaultAddress: "0x456",
      amountBaseUnits: "1"
    })).toThrow(/tokenAddress/);
  });

  it("builds a vault withdrawal call", () => {
    expect(buildYieldVaultWithdrawCall({
      vaultAddress: "0x456",
      tokenAddress: "0x123",
      sharesBaseUnits: "1000"
    })).toEqual({
      contractAddress: "0x456",
      entrypoint: "withdraw",
      calldata: ["1000", "0", "0x123"]
    });
  });

  it("builds router read calls for strategy state", () => {
    expect(buildRouterReadCalls({
      routerAddress: "0x789",
      tokenAddress: "0x123",
      strategyId: "0x45524334363236"
    })).toEqual([
      {
        contractAddress: "0x789",
        entrypoint: "get_strategy_adapter",
        calldata: ["0x45524334363236"]
      },
      {
        contractAddress: "0x789",
        entrypoint: "get_strategy_position",
        calldata: ["0x45524334363236", "0x123"]
      }
    ]);
  });
});
