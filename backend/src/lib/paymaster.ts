import type { AppConfig } from "../config.js";
import type { StarknetCall } from "../types.js";

/**
 * Execute Starknet calls through StarkZap with user-paid gas.
 *
 * The executor account class hash does not support outside execution (SNIP-9),
 * which AVNU requires for sponsored mode. Attempting sponsored first and
 * falling back on every call is wasteful and noisy — we go straight to
 * user_pays here.
 *
 * For frontend wallets (Privy / Cartridge / injected), sponsorship is handled
 * by the SDK on the frontend side via executeStarknetMulticallViaStarkZap.
 *
 * This is the single execution entry point for all backend Starknet txs:
 *   - faucet mint
 *   - capital deployment (attestation + rebalance)
 *
 * Returns { transaction_hash } to match the shape callers already expect.
 */
export async function executeSponsoredCalls(
  config: AppConfig,
  calls: StarknetCall[]
): Promise<{ transaction_hash: string }> {
  if (!calls.length) {
    throw new Error("executeSponsoredCalls: calls array is empty.");
  }
  if (!config.starknetAccountAddress || !config.starknetPrivateKey) {
    throw new Error(
      "Executor account not configured. " +
        "Set STARKNET_ACCOUNT_ADDRESS and STARKNET_PRIVATE_KEY on the backend."
    );
  }

  // Dynamically import to avoid bundling starkzap in environments that don't need it.
  const { StarkZap, StarkSigner } = await import("starkzap");

  // AVNU paymaster config — api key must be passed as an HTTP header, not a
  // top-level field. The correct header name is "x-paymaster-api-key".
  // This matches the AVNU docs, the starknet.js PaymasterRpc constructor, and
  // the StarkZap SDK paymaster config shape.
  const paymasterConfig =
    config.avnuPaymasterNodeUrl
      ? {
          nodeUrl: config.avnuPaymasterNodeUrl,
          ...(config.avnuPaymasterApiKey
            ? { headers: { "x-paymaster-api-key": config.avnuPaymasterApiKey } }
            : {}),
        }
      : undefined;

  const sdk = new StarkZap({
    network: config.starknetNetwork as "mainnet" | "sepolia",
    ...(config.starknetRpcUrl ? { rpcUrl: config.starknetRpcUrl } : {}),
    ...(paymasterConfig ? { paymaster: paymasterConfig } : {}),
  });

  const signer = new StarkSigner(config.starknetPrivateKey);
  const wallet = await sdk.connectWallet({
    account: { signer },
    accountAddress: config.starknetAccountAddress as string & {
      readonly __type: "StarknetAddress";
    },
  });

  const mapped = calls.map((call) => ({
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    calldata: call.calldata,
  }));

  // Backend executor always uses user_pays — the executor account is not
  // SNIP-9 compatible, so AVNU sponsored mode will always fail.
  const tx = await wallet.execute(mapped, { feeMode: "user_pays" });
  await tx.wait();
  console.log(`[StarkZap] user_pays tx confirmed: ${tx.hash}`);
  return { transaction_hash: tx.hash };
}