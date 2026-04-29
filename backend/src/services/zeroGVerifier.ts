import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import type { AppConfig } from "../config.js";

export type ZeroGVerificationResult = {
  configured: boolean;
  verified: boolean;
  providerAddress?: string;
  chatId?: string;
  verification?: unknown;
  setupRequired?: string[];
  error?: string;
};

export class ZeroGVerifierService {
  constructor(private readonly config: AppConfig) {}

  getStatus(): ZeroGVerificationResult {
    const setupRequired = this.getSetupRequired();
    return {
      configured: setupRequired.length === 0,
      verified: false,
      providerAddress: this.config.zgProviderAddress || undefined,
      setupRequired
    };
  }

  async verifyProvider(providerAddress = this.config.zgProviderAddress): Promise<ZeroGVerificationResult> {
    const setupRequired = this.getSetupRequired(providerAddress);
    if (setupRequired.length > 0) {
      return { configured: false, verified: false, providerAddress: providerAddress || undefined, setupRequired };
    }

    try {
      await mkdir(this.config.zgReportsDir, { recursive: true });
      const broker = await this.createBroker();
      const result = await broker.inference.verifyService(
        providerAddress,
        this.config.zgReportsDir,
        () => undefined
      );
      const signerOk = Boolean(result?.signerVerification?.allMatch);
      const composeOk = Boolean(result?.composeVerification?.passed);
      return {
        configured: true,
        verified: signerOk && composeOk,
        providerAddress,
        verification: result
      };
    } catch (error) {
      return {
        configured: true,
        verified: false,
        providerAddress,
        error: (error as Error).message
      };
    }
  }

  async verifyResponse(input: {
    providerAddress?: string;
    chatId?: string;
  }): Promise<ZeroGVerificationResult> {
    const providerAddress = input.providerAddress || this.config.zgProviderAddress;
    const setupRequired = this.getSetupRequired(providerAddress);
    if (!input.chatId) setupRequired.push("Capture the 0G response id from the `ZG-Res-Key` response header or response body.");
    if (setupRequired.length > 0) {
      return { configured: false, verified: false, providerAddress: providerAddress || undefined, chatId: input.chatId, setupRequired };
    }

    try {
      const broker = await this.createBroker();
      const verified = await broker.inference.processResponse(providerAddress, input.chatId);
      return {
        configured: true,
        verified: Boolean(verified),
        providerAddress,
        chatId: input.chatId,
        verification: verified
      };
    } catch (error) {
      return {
        configured: true,
        verified: false,
        providerAddress,
        chatId: input.chatId,
        error: (error as Error).message
      };
    }
  }

  private getSetupRequired(providerAddress = this.config.zgProviderAddress): string[] {
    const missing: string[] = [];
    if (!this.config.zgPrivateKey) missing.push("Set `ZG_PRIVATE_KEY` to an EVM wallet funded with 0G tokens.");
    if (!this.config.zgRpcUrl) missing.push("Set `ZG_RPC_URL` to `https://evmrpc-testnet.0g.ai` or `https://evmrpc.0g.ai`.");
    if (!providerAddress) missing.push("Set `ZG_PROVIDER_ADDRESS` to the chosen 0G Compute provider.");
    return missing;
  }

  private async createBroker(): Promise<any> {
    const [{ ethers }, brokerSdk] = await Promise.all([
      import("ethers"),
      importZeroGBrokerSdk()
    ]);
    const provider = new ethers.JsonRpcProvider(this.config.zgRpcUrl);
    const wallet = new ethers.Wallet(this.config.zgPrivateKey, provider);
    return brokerSdk.createZGComputeNetworkBroker(wallet as any);
  }
}

async function importZeroGBrokerSdk(): Promise<{ createZGComputeNetworkBroker: (wallet: unknown) => unknown }> {
  const require = createRequire(import.meta.url);
  return require("@0glabs/0g-serving-broker") as { createZGComputeNetworkBroker: (wallet: unknown) => unknown };
}
