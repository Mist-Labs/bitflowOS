import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { StarkZapService } from "../src/services/starkzap.js";

describe("StarkZap service", () => {
  it("exposes the three wallet onboarding paths", () => {
    const config = loadConfig({
      STARKNET_RPC_URL: "https://starknet-mainnet.public.blastapi.io/rpc/v0_7",
      BITFLOWOS_VAULT_ADDRESS: "0x123",
      PRIVY_APP_ID: "app_123",
      PRIVY_SERVER_URL: "https://privy.example.com"
    });
    const service = new StarkZapService(config);
    const walletIds = service.getFrontendConfig().walletEntryPoints.map(option => option.id);

    expect(walletIds).toEqual(["connect-wallet", "privy", "cartridge"]);
  });

  it("builds Cartridge policies for enabled token approvals and vault actions", () => {
    const config = loadConfig({
      STARKNET_RPC_URL: "https://starknet-mainnet.public.blastapi.io/rpc/v0_7",
      BITFLOWOS_VAULT_ADDRESS: "0x123"
    });
    const policies = new StarkZapService(config).buildCartridgePolicies();

    expect(policies).toContainEqual({ target: config.tokens.WBTC.address, method: "approve" });
    expect(policies).toContainEqual({ target: "0x123", method: "deposit" });
    expect(policies).toContainEqual({ target: "0x123", method: "withdraw" });
  });
});
