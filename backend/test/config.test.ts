import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("backend config", () => {
  it("preserves configured BTC wrapper decimals for test tokens", () => {
    const config = loadConfig({
      STARKNET_NETWORK: "sepolia",
      STARKNET_RPC_URL: "https://starknet-sepolia.example/rpc",
      BITFLOWOS_VAULT_ADDRESS: "0x123",
      SUPPORTED_TOKENS_JSON: JSON.stringify({
        SBTC_TEST: {
          symbol: "SBTC_TEST",
          address: "0x456",
          decimals: 18,
          enabled: true,
          kind: "mock"
        }
      })
    } as NodeJS.ProcessEnv);

    expect(config.tokens.SBTC_TEST.decimals).toBe(18);
  });
});
