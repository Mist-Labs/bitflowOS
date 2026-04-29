import type { AppConfig } from "../config.js";

export class StarkZapService {
  constructor(private readonly config: AppConfig) {}

  getFrontendConfig() {
    const cartridgePolicies = this.buildCartridgePolicies();

    return {
      package: "starkzap",
      network: this.config.starknetNetwork,
      rpcUrl: this.config.starknetRpcUrl,
      walletEntryPoints: [
        {
          id: "connect-wallet",
          label: "Connect Wallet",
          strategy: "external",
          recommendedFor: "Users who already have Argent, Braavos, or another Starknet wallet.",
          accountPreset: "user_wallet"
        },
        {
          id: "privy",
          label: "Continue with Email",
          strategy: "privy",
          recommendedFor: "Mainstream users who want embedded wallet UX without seed phrases.",
          accountPreset: "argentXV050",
          enabled: Boolean(this.config.privyAppId && this.config.privyServerUrl),
          appId: this.config.privyAppId || undefined,
          serverUrl: this.config.privyServerUrl || undefined,
          paymaster: this.config.avnuPaymasterNodeUrl ? "avnu" : "user_fee"
        },
        {
          id: "cartridge",
          label: "Use Passkey",
          strategy: "cartridge",
          recommendedFor: "Fast session UX with policy-bound sponsored BitflowOS calls.",
          accountPreset: "cartridge_controller",
          enabled: true,
          namespace: this.config.cartridgeNamespace,
          policies: cartridgePolicies,
          paymaster: "cartridge_policy"
        }
      ],
      paymasters: {
        avnu: {
          enabled: Boolean(this.config.avnuPaymasterNodeUrl),
          nodeUrl: this.config.avnuPaymasterNodeUrl || undefined,
          usedFor: ["privy", "server-side operations where explicitly enabled"]
        },
        cartridge: {
          enabled: true,
          policyBound: true,
          policies: cartridgePolicies
        }
      },
      productModules: {
        tokenOperations: true,
        swaps: ["AVNU", "Ekubo"],
        lending: ["Vesu"],
        staking: ["Starknet native staking", "Endur BTC LST routes"],
        bridging: {
          starkzap: ["Ethereum", "Solana"],
          atomiq: ["Bitcoin L1", "Bitcoin Lightning"]
        },
        confidentialTransfers: "available_via_starkzap_tongo_when_enabled"
      }
    };
  }

  buildCartridgePolicies(): Array<{ target: string; method: string }> {
    const tokenPolicies = Object.values(this.config.tokens)
      .filter(token => token.enabled)
      .flatMap(token => [
        { target: token.address, method: "approve" },
        { target: token.address, method: "transfer" }
      ]);

    return [
      ...tokenPolicies,
      { target: this.config.bitflowosVaultAddress, method: "deposit" },
      { target: this.config.bitflowosVaultAddress, method: "withdraw" }
    ];
  }

  async createSdk() {
    const { StarkZap } = await import("starkzap");
    return new StarkZap({
      network: this.config.starknetNetwork,
      rpcUrl: this.config.starknetRpcUrl,
      paymaster: this.config.avnuPaymasterNodeUrl
        ? { nodeUrl: this.config.avnuPaymasterNodeUrl, default: true }
        : undefined
    });
  }
}
