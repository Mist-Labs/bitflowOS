import { getStarkZapConfig } from "./api";
import {
  discoverInjectedStarknetWallets,
  getRuntimeStarknetWallet,
} from "./starknet-wallet-runtime";

type StarknetCall = {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
};

type WalletSnapshot = {
  chain: "starknet" | "bitcoin" | "privy" | "cartridge";
  label: string;
  address?: string;
} | null;

type ExecutionResult = {
  transaction_hash?: string;
  transactionHash?: string;
};

type StarknetWalletApi = {
  id?: string;
  name?: string;
  selectedAddress?: string;
  account?: {
    address?: string;
    execute?: (
      calls: StarknetCall[],
      options?: unknown,
    ) => Promise<ExecutionResult>;
    executePaymasterTransaction?: (
      calls: StarknetCall[],
      paymasterDetails: unknown,
    ) => Promise<ExecutionResult>;
  };
  request?: (input: { type: string }) => Promise<string[]>;
  enable?: () => Promise<string[]>;
};

export async function executeStarknetMulticallViaStarkZap(
  calls: StarknetCall[],
) {
  if (!calls.length) {
    throw new Error("StarkZap execution requires at least one call.");
  }

  const config = await getStarkZapConfig();
  if (config.package !== "starkzap") {
    throw new Error(
      "StarkZap config endpoint did not return the StarkZap execution surface.",
    );
  }

  let wallet = getConnectedStarknetWallet();
  if (!wallet) {
    throw new Error(
      "StarkZap could not find a connected Starknet wallet execution account.",
    );
  }

  await enableWallet(wallet);
  wallet = getConnectedStarknetWallet();
  if (!wallet?.account?.execute) {
    throw new Error(
      "Wallet connection is active, but no Starknet execution account is available. " +
        "Unlock the wallet, select the connected Starknet account, and try again.",
    );
  }
  assertWalletMatchesConnection(wallet);

  const result = await executeWithPaymaster(wallet, calls, config);
  const hash = result.transaction_hash ?? result.transactionHash;
  if (!hash) {
    throw new Error(
      "StarkZap multicall submitted, but the wallet did not return a transaction hash.",
    );
  }

  return {
    hash,
    route: "starkzap",
    network: config.network,
    callCount: calls.length,
    sponsored: !!config.paymasters?.avnu?.enabled,
  };
}

/**
 * Attempt AVNU-sponsored execution first.
 *
 * Privy embedded wallets (ArgentX V050) and Cartridge are SNIP-9 compatible
 * and will succeed on the sponsored path.
 *
 * SNIP-9 incompatible wallets (Argent X mobile, Braavos) throw on the
 * paymaster path — caught here, falls back to user-paid gas.
 */
async function executeWithPaymaster(
  wallet: StarknetWalletApi,
  calls: StarknetCall[],
  config: Awaited<ReturnType<typeof getStarkZapConfig>>,
): Promise<ExecutionResult> {
  if (config.paymasters?.avnu?.enabled) {
    try {
      // Path 1: wallet already exposes executePaymasterTransaction directly
      if (wallet.account?.executePaymasterTransaction) {
        return await wallet.account.executePaymasterTransaction(calls, {
          feeMode: { mode: "sponsored" as const },
          timeBounds: {
            executeBefore: Math.floor(Date.now() / 1000) + 30 * 60,
          },
        });
      }

      // Path 2: wrap injected wallet in starknet.js WalletAccount with AVNU
      // paymaster config, then call executePaymasterTransaction on that
      const walletAccount = await connectWithPaymaster(wallet, config);
      if (walletAccount?.executePaymasterTransaction) {
        return await walletAccount.executePaymasterTransaction(calls, {
          feeMode: { mode: "sponsored" as const },
          timeBounds: {
            executeBefore: Math.floor(Date.now() / 1000) + 30 * 60,
          },
        });
      }
    } catch (paymasterErr) {
      // SNIP-9 incompatible accounts throw here — fall through to user-pays.
      console.warn(
        "[StarkZap] AVNU paymaster unavailable, falling back to user-paid gas:",
        paymasterErr,
      );
    }
  }

  // Fallback: user pays gas. Requires STRK in wallet.
  if (!wallet.account?.execute) {
    throw new Error(
      "No execution account available. Reconnect your wallet and try again.",
    );
  }
  return wallet.account.execute(calls);
}

async function connectWithPaymaster(
  wallet: StarknetWalletApi,
  config: Awaited<ReturnType<typeof getStarkZapConfig>>,
) {
  try {
    const { RpcProvider, WalletAccount } = await import("starknet");
    const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
    const { PaymasterRpc } = await import("starknet");
    const paymaster = new PaymasterRpc({
      nodeUrl: `${API_URL}/api/paymaster`,
    });
    return WalletAccount.connect(
      provider,
      wallet as never,
      undefined,
      paymaster,
    );
  } catch {
    return undefined;
  }
}

async function enableWallet(wallet: StarknetWalletApi) {
  if (wallet.request) {
    await wallet.request({ type: "wallet_requestAccounts" });
    return;
  }
  await wallet.enable?.();
}

function assertWalletMatchesConnection(wallet: StarknetWalletApi) {
  const connected = readWalletSnapshot();
  if (!connected?.address) return;
  const activeAddress = wallet.selectedAddress ?? wallet.account?.address;
  if (!activeAddress) return;
  if (normalize(activeAddress) !== normalize(connected.address)) {
    throw new Error(
      "The active Starknet wallet account does not match the connected BitflowOS account. " +
        "Switch accounts in your wallet and try again.",
    );
  }
}

function getConnectedStarknetWallet(): StarknetWalletApi | undefined {
  if (typeof window === "undefined") return undefined;
  const connected = readWalletSnapshot();
  const runtimeWallet = getRuntimeStarknetWallet();
  const wallets = [runtimeWallet, ...discoverInjectedStarknetWallets()].filter(
    Boolean,
  ) as StarknetWalletApi[];

  if (!connected?.address) return wallets[0];
  return (
    wallets.find(
      (w) =>
        normalize(w.selectedAddress ?? w.account?.address) ===
        normalize(connected.address),
    ) ?? wallets[0]
  );
}

function readWalletSnapshot(): WalletSnapshot {
  try {
    const raw = window.localStorage.getItem("bitflowos.connectedWallet");
    return raw ? (JSON.parse(raw) as WalletSnapshot) : null;
  } catch {
    return null;
  }
}

function normalize(value?: string) {
  if (!value) return "";
  return `0x${BigInt(value).toString(16)}`;
}
