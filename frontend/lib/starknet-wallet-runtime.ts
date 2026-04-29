type StarknetWalletApi = {
  id?: string;
  name?: string;
  selectedAddress?: string;
  account?: {
    address?: string;
    execute?: (calls: Array<{
      contractAddress: string;
      entrypoint: string;
      calldata: string[];
    }>) => Promise<{
      transaction_hash?: string;
      transactionHash?: string;
    }>;
  };
  request?: (input: { type: string }) => Promise<string[]>;
  enable?: () => Promise<string[]>;
};

let runtimeWallet: StarknetWalletApi | undefined;

export function setRuntimeStarknetWallet(wallet: StarknetWalletApi | undefined) {
  runtimeWallet = wallet;
}

export function clearRuntimeStarknetWallet() {
  runtimeWallet = undefined;
}

export function getRuntimeStarknetWallet() {
  return runtimeWallet ?? discoverInjectedStarknetWallets()[0];
}

export function discoverInjectedStarknetWallets() {
  if (typeof window === "undefined") return [];
  const candidate = window as unknown as {
    starknet?: StarknetWalletApi;
    starknet_argentX?: StarknetWalletApi;
    starknet_braavos?: StarknetWalletApi;
  };

  return [
    candidate.starknet,
    candidate.starknet_argentX,
    candidate.starknet_braavos
  ].filter(Boolean) as StarknetWalletApi[];
}
