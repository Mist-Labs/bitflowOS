const U128_MAX = (1n << 128n) - 1n;

export function assertPositiveIntegerString(value: string, fieldName: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${fieldName} must be a positive integer string`);
  }
  return BigInt(value);
}

export function decimalToBaseUnits(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error("amount must be a non-negative decimal string");
  }

  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    throw new Error(`amount has more than ${decimals} decimals`);
  }

  const paddedFraction = fraction.padEnd(decimals, "0");
  return BigInt(`${whole}${paddedFraction}`.replace(/^0+(?=\d)/, ""));
}

export function toUint256Calldata(value: bigint): [string, string] {
  if (value < 0n) throw new Error("uint256 cannot be negative");
  const low = value & U128_MAX;
  const high = value >> 128n;
  if (high > U128_MAX) throw new Error("value exceeds uint256");
  return [low.toString(), high.toString()];
}
