import type { Strategy } from "./types";

export const strategies: Strategy[] = [
  {
    id: "vesu-supply",
    name: "BTC Lending",
    protocol: "Vesu",
    asset: "WBTC / LBTC / tBTC",
    allocation: 42,
    apy: "4.8%",
    risk: "low",
    status: "guarded",
    description: "ERC4626 vToken route plus collateral-aware Vesu integration after final address wiring."
  },
  {
    id: "endur-lst",
    name: "BTC Liquid Staking",
    protocol: "Endur",
    asset: "xWBTC / xLBTC / xtBTC",
    allocation: 26,
    apy: "5.6%",
    risk: "medium",
    status: "ready",
    description: "BTC LST route through ERC4626-compatible vault adapter where mainnet vaults are enabled."
  },
  {
    id: "ekubo-lp",
    name: "BTC Liquidity",
    protocol: "Ekubo",
    asset: "Sepolia pool route",
    allocation: 0,
    apy: "SYNCING",
    risk: "high",
    status: "guarded",
    description: "Positions ABI route is deployed but UI deposits stay disabled until pool-specific quote and slippage checks are live."
  },
  {
    id: "idle-reserve",
    name: "Idle Reserve",
    protocol: "BitflowOS",
    asset: "BTC wrappers",
    allocation: 20,
    apy: "0.0%",
    risk: "low",
    status: "live",
    description: "Withdrawal and rebalance buffer held inside the vault."
  }
];

export const alertEvents = [
  "bridge_started",
  "bridge_completed",
  "deposit_ready",
  "deposit_confirmed",
  "staking_started",
  "harvest_available",
  "harvest_executed",
  "unstake_started",
  "withdrawal_requested",
  "withdrawal_completed",
  "position_health_warning",
  "transaction_failed"
];
