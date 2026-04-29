import type { StarknetCall } from "../types.js";
import { assertPositiveIntegerString, toUint256Calldata } from "./amounts.js";
import { hash } from "starknet";

export function assertStarknetAddress(value: string, fieldName = "address"): string {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new Error(`${fieldName} must be a Starknet felt address`);
  }
  return value;
}

export function buildYieldVaultDepositCalls(input: {
  tokenAddress: string;
  vaultAddress: string;
  amountBaseUnits: string;
}): StarknetCall[] {
  const tokenAddress = assertStarknetAddress(input.tokenAddress, "tokenAddress");
  const vaultAddress = assertStarknetAddress(input.vaultAddress, "vaultAddress");
  const amount = assertPositiveIntegerString(input.amountBaseUnits, "amountBaseUnits");
  const [amountLow, amountHigh] = toUint256Calldata(amount);

  return [
    {
      contractAddress: tokenAddress,
      entrypoint: "approve",
      calldata: [vaultAddress, amountLow, amountHigh]
    },
    {
      contractAddress: vaultAddress,
      entrypoint: "deposit",
      calldata: [tokenAddress, amountLow, amountHigh]
    }
  ];
}

export function buildYieldVaultWithdrawCall(input: {
  vaultAddress: string;
  tokenAddress: string;
  sharesBaseUnits: string;
}): StarknetCall {
  const vaultAddress = assertStarknetAddress(input.vaultAddress, "vaultAddress");
  const tokenAddress = assertStarknetAddress(input.tokenAddress, "tokenAddress");
  const shares = assertPositiveIntegerString(input.sharesBaseUnits, "sharesBaseUnits");
  const [sharesLow, sharesHigh] = toUint256Calldata(shares);

  return {
    contractAddress: vaultAddress,
    entrypoint: "withdraw",
    calldata: [sharesLow, sharesHigh, tokenAddress]
  };
}

export function buildRouterReadCalls(input: {
  routerAddress: string;
  strategyId: string;
  tokenAddress: string;
}): StarknetCall[] {
  const routerAddress = assertStarknetAddress(input.routerAddress, "routerAddress");
  const tokenAddress = assertStarknetAddress(input.tokenAddress, "tokenAddress");

  return [
    {
      contractAddress: routerAddress,
      entrypoint: "get_strategy_adapter",
      calldata: [input.strategyId]
    },
    {
      contractAddress: routerAddress,
      entrypoint: "get_strategy_position",
      calldata: [input.strategyId, tokenAddress]
    }
  ];
}

export function buildRouterHarvestCall(input: {
  routerAddress: string;
  strategyId: string;
  tokenAddress: string;
}): StarknetCall {
  const routerAddress = assertStarknetAddress(input.routerAddress, "routerAddress");
  const tokenAddress = assertStarknetAddress(input.tokenAddress, "tokenAddress");

  return {
    contractAddress: routerAddress,
    entrypoint: "harvest",
    calldata: [input.strategyId, tokenAddress]
  };
}

export async function starknetCall(input: {
  rpcUrl: string;
  contractAddress: string;
  entrypoint: string;
  calldata?: string[];
}): Promise<string[]> {
  const selector = hash.getSelectorFromName(input.entrypoint);
  const response = await fetch(input.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "starknet_call",
      params: [
        {
          contract_address: input.contractAddress,
          entry_point_selector: selector,
          calldata: input.calldata ?? []
        },
        "latest"
      ],
      id: 1
    })
  });

  if (!response.ok) {
    throw new Error(`Starknet RPC call failed with HTTP ${response.status}`);
  }

  const payload = await response.json() as {
    result?: string[];
    error?: { message?: string; code?: number; data?: unknown };
  };
  if (payload.error) {
    throw new Error(payload.error.message ?? `Starknet RPC error ${payload.error.code}`);
  }
  return payload.result ?? [];
}

export function parseU256(result: string[]): string {
  const low = BigInt(result[0] ?? "0x0");
  const high = BigInt(result[1] ?? "0x0");
  return ((high << 128n) + low).toString();
}

export function parseFelt(result: string[]): string {
  return result[0] ?? "0x0";
}
