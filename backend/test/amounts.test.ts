import { describe, expect, it } from "vitest";
import { decimalToBaseUnits, toUint256Calldata } from "../src/lib/amounts.js";

describe("amount helpers", () => {
  it("converts decimal amounts to base units", () => {
    expect(decimalToBaseUnits("0.00000001", 8)).toBe(1n);
    expect(decimalToBaseUnits("1.25", 8)).toBe(125000000n);
  });

  it("rejects excess precision", () => {
    expect(() => decimalToBaseUnits("0.000000001", 8)).toThrow(/more than 8 decimals/);
  });

  it("splits uint256 calldata into low and high limbs", () => {
    expect(toUint256Calldata((1n << 128n) + 7n)).toEqual(["7", "1"]);
  });
});
