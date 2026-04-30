import { describe, expect, it } from "vitest";
import { getFaucetWaitMs } from "../src/services/faucet.js";

describe("test token faucet", () => {
  it("allows a first claim and blocks repeats for 24 hours", () => {
    const now = Date.parse("2026-04-30T00:00:00.000Z");

    expect(getFaucetWaitMs(undefined, now)).toBe(0);
    expect(getFaucetWaitMs("2026-04-29T00:00:00.000Z", now)).toBe(0);
    expect(getFaucetWaitMs("2026-04-29T23:00:00.000Z", now)).toBe(23 * 60 * 60 * 1000);
  });
});
