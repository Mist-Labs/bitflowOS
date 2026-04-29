"use client";

import { buildWithdrawCall, getVaultState, sendPositionAlert } from "@/lib/api";
import { strategies } from "@/lib/data";
import { executeStarknetMulticallViaStarkZap } from "@/lib/starkzap-executor";
import type { AllocationRecommendation, AppConfig, VaultState } from "@/lib/types";
import { useEffect, useMemo, useState } from "react";

type WalletState = {
  chain: "starknet" | "bitcoin" | "privy" | "cartridge";
  label: string;
  address?: string;
} | null;

type AllocationProgress = {
  stage?: "deposit_submitted" | "allocating" | "recommendation_ready" | "plan_staged";
  recommendation?: AllocationRecommendation;
  timestamp?: string;
};

type PositionAction = "claim" | "withdraw";

const WALLET_KEY = "bitflowos.connectedWallet";

export function DashboardLive({ config }: { config: AppConfig }) {
  const [wallet, setWallet] = useState<WalletState>(null);
  const [vaultState, setVaultState] = useState<VaultState | null>(null);
  const [progress, setProgress] = useState<AllocationProgress | null>(null);
  const [lastRefresh, setLastRefresh] = useState("");

  const walletAddress = wallet?.address ?? "";
  const canReadVault = Boolean(walletAddress && /^0x[0-9a-fA-F]+$/.test(walletAddress));
  const isBitcoinWallet = wallet?.chain === "bitcoin";

  useEffect(() => {
    function readWallet() {
      try {
        const raw = window.localStorage.getItem(WALLET_KEY);
        setWallet(raw ? JSON.parse(raw) as WalletState : null);
      } catch {
        setWallet(null);
      }
    }

    function onWallet(event: Event) {
      const nextWallet = (event as CustomEvent<WalletState>).detail ?? null;
      setWallet(nextWallet);
      if (!nextWallet?.address || nextWallet.chain === "bitcoin") {
        setVaultState(null);
        setProgress(null);
        setLastRefresh("");
      }
    }

    readWallet();
    window.addEventListener("bitflowos:wallet", onWallet);
    window.addEventListener("storage", readWallet);
    return () => {
      window.removeEventListener("bitflowos:wallet", onWallet);
      window.removeEventListener("storage", readWallet);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      if (!canReadVault) {
        setVaultState(null);
        setProgress(null);
        setLastRefresh("");
        return;
      }
      const state = await getVaultState(walletAddress);
      if (!cancelled) {
        setVaultState(state);
        setLastRefresh(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      }
    }

    void refresh();
    const interval = canReadVault ? window.setInterval(refresh, 5000) : undefined;

    function onRefresh() {
      void refresh();
    }

    window.addEventListener("bitflowos:vault-refresh", onRefresh);
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
      window.removeEventListener("bitflowos:vault-refresh", onRefresh);
    };
  }, [walletAddress, canReadVault]);

  useEffect(() => {
    function onProgress(event: Event) {
      if (!canReadVault) return;
      setProgress((event as CustomEvent<AllocationProgress>).detail ?? null);
      window.dispatchEvent(new CustomEvent("bitflowos:vault-refresh"));
    }

    window.addEventListener("bitflowos:allocation-progress", onProgress);
    return () => window.removeEventListener("bitflowos:allocation-progress", onProgress);
  }, [canReadVault]);

  const totals = useMemo(() => summarizeVault(vaultState), [vaultState]);
  const stage = progress?.stage ?? (canReadVault ? "connected" : "waiting");
  const hasPosition = totals.userManagedRaw > 0n;
  const liveApy = progress?.recommendation ? recommendationApy(progress.recommendation) : hasPosition ? strategyApy(vaultState) : "SYNCING";
  const lastRebalance = progress?.stage === "plan_staged"
    ? "STAGED"
    : progress?.stage === "recommendation_ready"
      ? "TEE READY"
      : progress?.stage === "allocating"
        ? "BUILDING"
        : hasPosition
          ? "LIVE"
          : "--";
  const lastRebalanceHint = isBitcoinWallet
    ? "connect Starknet vault wallet"
    : lastRefresh
      ? hasPosition
        ? `vault indexed · ${lastRefresh}`
        : `${stage} · ${lastRefresh}`
      : "router events pending";

  return (
    <section className="stats-grid">
      <div className="stat-card">
        <span>Total BTC Managed</span>
        <strong className={totals.userManagedRaw > 0n ? "amber" : "amber muted-value"}>{totals.userManagedLabel}</strong>
        <small>{isBitcoinWallet ? "BTC intake wallet connected" : canReadVault ? `${short(walletAddress)} managed position` : config.vaultAddress ? "connect Starknet wallet for position" : "awaiting deployment"}</small>
      </div>
      <div className="stat-card">
        <span>Vault APY</span>
        <strong className="green">{liveApy}</strong>
        <small>{progress?.recommendation ? "weighted Kimi strategy plan" : hasPosition ? "live configured route blend" : isBitcoinWallet ? "connect Starknet vault wallet" : "from live strategy feeds"}</small>
      </div>
      <div className="stat-card">
        <span>yBTC in Circulation</span>
        <strong>{totals.totalAssetsLabel}</strong>
        <small>{canReadVault ? totals.totalAssetsRaw > 0n ? `${totals.primarySymbol} vault feed` : "share price after deployment" : "connect Starknet wallet for vault feed"}</small>
      </div>
      <div className="stat-card">
        <span>Last Rebalance</span>
        <strong className={lastRebalance === "STAGED" || lastRebalance === "LIVE" ? "green" : undefined} style={{ fontSize: 20 }}>{lastRebalance}</strong>
        <small>{lastRebalanceHint}</small>
      </div>
    </section>
  );
}

export function LiveAllocation() {
  const [wallet, setWallet] = useState<WalletState>(null);
  const [progress, setProgress] = useState<AllocationProgress | null>(null);
  const [vaultState, setVaultState] = useState<VaultState | null>(null);
  const canReadVault = Boolean(wallet?.address && /^0x[0-9a-fA-F]+$/.test(wallet.address));

  useEffect(() => {
    function readWallet() {
      try {
        const raw = window.localStorage.getItem(WALLET_KEY);
        setWallet(raw ? JSON.parse(raw) as WalletState : null);
      } catch {
        setWallet(null);
      }
    }

    function onWallet(event: Event) {
      const nextWallet = (event as CustomEvent<WalletState>).detail ?? null;
      setWallet(nextWallet);
      if (!nextWallet?.address || nextWallet.chain === "bitcoin") {
        setProgress(null);
        setVaultState(null);
      }
    }

    readWallet();
    window.addEventListener("bitflowos:wallet", onWallet);
    window.addEventListener("storage", readWallet);
    return () => {
      window.removeEventListener("bitflowos:wallet", onWallet);
      window.removeEventListener("storage", readWallet);
    };
  }, []);

  useEffect(() => {
    function onProgress(event: Event) {
      if (!canReadVault) return;
      setProgress((event as CustomEvent<AllocationProgress>).detail ?? null);
    }

    window.addEventListener("bitflowos:allocation-progress", onProgress);
    return () => window.removeEventListener("bitflowos:allocation-progress", onProgress);
  }, [canReadVault]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (!canReadVault || !wallet?.address) {
        setVaultState(null);
        return;
      }
      const state = await getVaultState(wallet.address);
      if (!cancelled) setVaultState(state);
    }

    void refresh();
    window.addEventListener("bitflowos:vault-refresh", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("bitflowos:vault-refresh", refresh);
    };
  }, [canReadVault, wallet?.address]);

  const liveStrategies = useMemo(() => {
    const rec = progress?.recommendation;
    if (!rec) return strategies;
    return strategies.map(strategy => {
      const weight = rec.weights.find(item => item.strategyId === strategy.id || item.label.toLowerCase().includes(strategy.name.toLowerCase()));
      return weight ? { ...strategy, allocation: Math.round(weight.targetBps / 100) } : strategy;
    });
  }, [progress]);

  return (
    <>
      <div className="alloc-body">
        {liveStrategies.map(strategy => (
          <div className="alloc-row" key={strategy.id}>
            <div>
              <strong>{strategy.name}</strong>
              <small>{strategy.protocol}</small>
            </div>
            <div className="alloc-bar-wrap">
              <span className={`alloc-bar ${strategy.risk}`} style={{ width: `${strategy.allocation}%` }} />
            </div>
            <span>{strategy.allocation}%</span>
            <span className="green-text">{strategy.apy}</span>
          </div>
        ))}
      </div>
      <PositionActions wallet={wallet} externalVaultState={vaultState} />
    </>
  );
}

function PositionActions({ wallet, externalVaultState }: { wallet: WalletState; externalVaultState?: VaultState | null }) {
  const [busy, setBusy] = useState<PositionAction | null>(null);
  const [status, setStatus] = useState("");
  const [vaultState, setVaultState] = useState<VaultState | null>(null);
  const walletAddress = wallet?.address ?? "";
  const canReadVault = Boolean(walletAddress && /^0x[0-9a-fA-F]+$/.test(walletAddress));
  const position = useMemo(() => findPositionAsset(vaultState), [vaultState]);
  const hasPosition = Boolean(canReadVault && position && (toBigInt(position.userShares) > 0n || toBigInt(position.userAssetShares) > 0n));
  const hasClaimableRewards = false;

  useEffect(() => {
    if (externalVaultState) setVaultState(externalVaultState);
  }, [externalVaultState]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      if (!canReadVault) {
        setVaultState(null);
        setStatus("");
        return;
      }
      const state = await getVaultState(walletAddress);
      if (!cancelled) setVaultState(state);
    }

    void refresh();
    window.addEventListener("bitflowos:vault-refresh", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("bitflowos:vault-refresh", refresh);
    };
  }, [walletAddress, canReadVault]);

  useEffect(() => {
    function onAction(event: Event) {
      const action = (event as CustomEvent<{ action?: PositionAction }>).detail?.action;
      if (action === "claim") void claimRewards();
      if (action === "withdraw") void withdrawAll();
    }

    window.addEventListener("bitflowos:position-action-request", onAction);
    return () => window.removeEventListener("bitflowos:position-action-request", onAction);
  }, [walletAddress, position?.symbol, position?.userShares, position?.userAssetShares]);

  async function claimRewards() {
    if (!canReadVault || !position) {
      setStatus(wallet?.chain === "bitcoin" ? "Connect your Starknet vault wallet to claim rewards." : "Connect a wallet with a vault position first.");
      return;
    }
    if (!hasClaimableRewards) {
      setStatus("No separate rewards to claim yet. Yield is reflected in your yBTC position value and is received when you withdraw.");
      return;
    }
  }

  async function withdrawAll() {
    if (!canReadVault || !position) {
      setStatus(wallet?.chain === "bitcoin" ? "Connect your Starknet vault wallet to withdraw." : "Connect a wallet with a vault position first.");
      return;
    }
    const shares = toBigInt(position.userAssetShares) > 0n ? position.userAssetShares : position.userShares;
    if (toBigInt(shares) <= 0n) {
      setStatus("No withdrawable yBTC shares found for this wallet.");
      return;
    }

    setBusy("withdraw");
    setStatus("Preparing withdrawal...");
    try {
      const call = await buildWithdrawCall({ tokenSymbol: position.symbol, sharesBaseUnits: shares });
      const execution = await executeStarknetMulticallViaStarkZap([call.call]);
      setStatus(`Withdrawal submitted: ${short(execution.hash)}.`);
      void sendPositionAlert({
        walletAddress,
        type: "withdrawal_requested",
        title: "Withdrawal submitted",
        body: `BitflowOS withdrawal was submitted for ${position.symbol}.`,
        transactionHash: execution.hash
      });
      window.dispatchEvent(new CustomEvent("bitflowos:vault-refresh"));
    } catch (error) {
      setStatus(`Withdraw failed: ${(error as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="position-actions">
      <div>
        <strong>Position Controls</strong>
        <small>{wallet?.chain === "bitcoin" ? "connect Starknet wallet to manage vault" : canReadVault ? hasPosition ? `${position?.symbol} position active` : "no active position for this wallet" : "connect wallet to manage positions"}</small>
      </div>
      <div className="position-action-buttons">
        <button onClick={claimRewards} disabled={!hasPosition || busy !== null} type="button">
          {busy === "claim" ? "Checking..." : hasClaimableRewards ? "Claim Rewards" : "Rewards"}
        </button>
        <button onClick={withdrawAll} disabled={!hasPosition || busy !== null} type="button">
          {busy === "withdraw" ? "Signing..." : "Withdraw All"}
        </button>
      </div>
      {status ? <p>{status}</p> : null}
    </div>
  );
}

function summarizeVault(state: VaultState | null) {
  if (!state?.assets.length) {
    return {
      totalAssetsRaw: 0n,
      totalAssetsLabel: "--",
      userManagedRaw: 0n,
      userManagedLabel: "--",
      primarySymbol: "BTC"
    };
  }

  const primary = state.assets.find(asset => toBigInt(asset.totalAssets) > 0n)
    ?? state.assets.find(asset => toBigInt(asset.userShares) > 0n || toBigInt(asset.userAssetShares) > 0n)
    ?? state.assets[0];
  const totalAssetsRaw = state.assets.reduce((sum, asset) => sum + toBigInt(asset.totalAssets), 0n);
  const userSharesRaw = state.assets.reduce((sum, asset) => sum + toBigInt(asset.userShares) + toBigInt(asset.userAssetShares), 0n);

  return {
    totalAssetsRaw,
    totalAssetsLabel: totalAssetsRaw > 0n ? compactUnits(totalAssetsRaw, primary.decimals) : "--",
    userManagedRaw: userSharesRaw,
    userManagedLabel: userSharesRaw > 0n ? compactUnits(userSharesRaw, primary.decimals) : "--",
    primarySymbol: primary.symbol
  };
}

function findPositionAsset(state: VaultState | null) {
  return state?.assets.find(asset => toBigInt(asset.userAssetShares) > 0n)
    ?? state?.assets.find(asset => toBigInt(asset.userShares) > 0n)
    ?? null;
}

function strategyApy(state: VaultState | null) {
  if (!state?.strategies.length) return "SYNCING";
  const configured = state.strategies.filter(strategy => strategy.configured);
  if (!configured.length) return "SYNCING";
  const apy = configured.some(strategy => strategy.kind === "ekubo") ? 5.1 : 4.8;
  return `${apy.toFixed(1)}%`;
}

function recommendationApy(recommendation: AllocationRecommendation) {
  const weighted = recommendation.weights.reduce((sum, item) => {
    const label = item.label.toLowerCase();
    const apy = label.includes("ekubo") ? 5.6 : label.includes("idle") ? 0 : 4.8;
    return sum + apy * (item.targetBps / 10000);
  }, 0);
  return `${Math.max(weighted, 0).toFixed(1)}%`;
}

function compactUnits(value: bigint, decimals: number) {
  if (decimals <= 0) return value.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (whole > 0n) {
    const frac = fraction.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : whole.toString();
  }
  const raw = fraction.toString().padStart(decimals, "0");
  const firstNonZero = raw.search(/[1-9]/);
  if (firstNonZero === -1) return "0";
  return `0.${raw.slice(0, Math.min(decimals, firstNonZero + 4)).replace(/0+$/, "")}`;
}

function toBigInt(value?: string) {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}

function short(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
