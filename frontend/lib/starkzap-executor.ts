import { getStarkZapConfig } from "./api";
import { discoverInjectedStarknetWallets, getRuntimeStarknetWallet } from "./starknet-wallet-runtime";

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

type StarknetWalletApi = {
  selectedAddress?: string;
  account?: {
    address?: string;
    execute?: (calls: StarknetCall[]) => Promise<{
      transaction_hash?: string;
      transactionHash?: string;
    }>;
  };
  request?: (input: { type: string }) => Promise<string[]>;
  enable?: () => Promise<string[]>;
};

export async function executeStarknetMulticallViaStarkZap(calls: StarknetCall[]) {
  if (!calls.length) {
    throw new Error("StarkZap execution requires at least one call.");
  }

  const config = await getStarkZapConfig();
  if (config.package !== "starkzap") {
    throw new Error("StarkZap config endpoint did not return the StarkZap execution surface.");
  }

  let wallet = getConnectedStarknetWallet();
  if (!wallet) {
    throw new Error("StarkZap could not find a connected Starknet wallet execution account.");
  }

  await enableWallet(wallet);
  wallet = getConnectedStarknetWallet();
  if (!wallet?.account?.execute) {
    throw new Error("Wallet connection is active, but no Starknet execution account is available. Unlock the wallet, select the connected Starknet account, and try again.");
  }
  assertWalletMatchesConnection(wallet);

  const result = await wallet.account.execute(calls);
  const hash = result.transaction_hash ?? result.transactionHash;
  if (!hash) {
    throw new Error("StarkZap multicall submitted, but the wallet did not return a transaction hash.");
  }

  return {
    hash,
    route: "starkzap",
    network: config.network,
    callCount: calls.length
  };
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
    throw new Error("The active Starknet wallet account does not match the connected BitflowOS account. Switch accounts in your wallet and try again.");
  }
}

function getConnectedStarknetWallet(): StarknetWalletApi | undefined {
  if (typeof window === "undefined") return undefined;
  const connected = readWalletSnapshot();
  const runtimeWallet = getRuntimeStarknetWallet();
  const wallets = [
    runtimeWallet,
    ...discoverInjectedStarknetWallets()
  ].filter(Boolean) as StarknetWalletApi[];

  if (!connected?.address) return wallets[0];
  return wallets.find(wallet => normalize(wallet.selectedAddress ?? wallet.account?.address) === normalize(connected.address))
    ?? wallets[0];
}

function readWalletSnapshot(): WalletSnapshot {
  try {
    const raw = window.localStorage.getItem("bitflowos.connectedWallet");
    return raw ? JSON.parse(raw) as WalletSnapshot : null;
  } catch {
    return null;
  }
}

function normalize(value?: string) {
  if (!value) return "";
  return `0x${BigInt(value).toString(16)}`;
}
