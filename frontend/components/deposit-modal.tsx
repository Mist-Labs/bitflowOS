"use client";

import { buildDepositCalls, createBridgeIntent, getVaultState, sendPositionAlert } from "@/lib/api";
import { executeStarknetMulticallViaStarkZap } from "@/lib/starkzap-executor";
import type { TokenConfig, VaultState } from "@/lib/types";
import { Bitcoin, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Source = "wrap" | "native";
type Step = 1 | 2 | 3;

const ASSET_META: Record<string, { proto: string; apy: string; dot: "green" | "blue" | "amber"; note: string }> = {
  LBTC: { proto: "Lombard Protocol", apy: "4.8%", dot: "green", note: "Staking yield" },
  WBTC: { proto: "BitGo", apy: "4.7%", dot: "green", note: "Most liquid" },
  TBTC: { proto: "Threshold Network", apy: "5.1%", dot: "green", note: "Decentralised" },
  SOLVBTC: { proto: "Solv Protocol", apy: "5.6%", dot: "blue", note: "Yield-bearing" },
  "SOLVBTC.B": { proto: "Solv Protocol (BNB)", apy: "5.4%", dot: "blue", note: "Cross-chain" },
  SBTC: { proto: "Stacks Protocol", apy: "4.5%", dot: "green", note: "L2 native" },
  SBTC_TEST: { proto: "BitflowOS Sepolia", apy: "5.47%", dot: "amber", note: "Test wrapper" },
  SBTC_EKUBO_TEST: { proto: "BitflowOS Ekubo Test", apy: "5.47%", dot: "blue", note: "Controlled pool" },
  BTCB: { proto: "Binance Wrapped BTC", apy: "4.4%", dot: "green", note: "CEX-backed" },
  BTC: { proto: "Native Bitcoin · Atomiq", apy: "5.47%", dot: "amber", note: "Atomic bridge" }
};

type WalletSnapshot = {
  chain: "starknet" | "bitcoin" | "privy" | "cartridge";
  label: string;
  address?: string;
} | null;

export function DepositModal({ tokens, vaultState }: { tokens: TokenConfig[]; vaultState?: VaultState }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [source, setSource] = useState<Source>("wrap");
  const [asset, setAsset] = useState(tokens[0]?.symbol ?? "LBTC");
  const [amount, setAmount] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [wallet, setWallet] = useState<WalletSnapshot>(null);
  const [userVaultState, setUserVaultState] = useState<VaultState | undefined>(vaultState);

  const selected = useMemo(() => getMeta(asset), [asset]);
  const normalizedAsset = asset.toUpperCase();
  const receiveAmount = formatReceive(amount);
  const route = source === "native" || normalizedAsset === "BTC"
    ? "BTC -> Atomiq -> SBTC -> Vault"
    : `${asset} -> StarkZap -> Vault`;
  const liveAsset = userVaultState?.assets.find(item => item.symbol.toUpperCase() === normalizedAsset);
  const selectedToken = tokens.find(item => item.symbol.toUpperCase() === normalizedAsset);
  const tokenDecimals = liveAsset?.decimals ?? selectedToken?.decimals ?? 18;
  const walletBalance = liveAsset?.userWalletBalance ?? "0";
  const displayWalletBalance = formatTokenUnits(walletBalance, tokenDecimals);
  const walletAddress = wallet?.address ?? (typeof window === "undefined" ? "" : readWalletAddress());
  const tokenAssets = tokens.map(item => item.symbol);

  useEffect(() => {
    function readWallet() {
      setWallet(readWalletSnapshot());
    }

    function onWallet(event: Event) {
      setWallet((event as CustomEvent<WalletSnapshot>).detail ?? null);
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
    if (!walletAddress || !/^0x[0-9a-fA-F]+$/.test(walletAddress)) {
      setUserVaultState(vaultState);
      return;
    }

    let cancelled = false;
    getVaultState(walletAddress)
      .then(state => {
        if (!cancelled) setUserVaultState(state);
      })
      .catch(() => {
        if (!cancelled) setUserVaultState(vaultState);
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress, vaultState]);

  useEffect(() => {
    if (!wallet?.address) {
      setOpen(false);
      setDropdownOpen(false);
      setResult("");
    }
  }, [wallet?.address]);

  function openModal() {
    setOpen(true);
    setStep(1);
    setResult("");
  }

  function closeModal() {
    setOpen(false);
    setDropdownOpen(false);
  }

  function setModalSource(next: Source) {
    setSource(next);
    setAsset(next === "native" ? "BTC" : tokens[0]?.symbol ?? "LBTC");
    setDropdownOpen(false);
    setResult("");
  }

  function selectAsset(next: string) {
    setAsset(next);
    setSource(next.toUpperCase() === "BTC" ? "native" : "wrap");
    setDropdownOpen(false);
    setResult("");
  }

  function reviewDeposit() {
    try {
      if (source !== "native" && normalizedAsset !== "BTC") {
        const amountBaseUnits = decimalToBaseUnits(amount || "0", tokenDecimals);
        if (BigInt(amountBaseUnits) > BigInt(walletBalance || "0")) {
          throw new Error(`Deposit amount exceeds your ${asset} wallet balance.`);
        }
        setAmount(normalizeAmountInput(amount, tokenDecimals));
      }
      setResult("");
      setStep(2);
    } catch (error) {
      setResult((error as Error).message);
    }
  }

  async function confirmAndSign() {
    setStep(3);
    setBusy(true);
    setResult("");
    try {
      if (source === "native" || normalizedAsset === "BTC") {
        if (!walletAddress) {
          setResult("Connect a Starknet wallet before creating the Atomiq quote.");
          return;
        }
        const intent = await createBridgeIntent({
          amountSats: amount || "0",
          destinationAddress: walletAddress,
          outputToken: "SBTC",
          source: "BTC"
        });
        setResult(`Atomiq quote ${intent.id}: send BTC to ${intent.paymentAddress ?? "quoted address"}.`);
        return;
      }

      const normalizedAmount = normalizeAmountInput(amount || "0", tokenDecimals);
      const amountBaseUnits = decimalToBaseUnits(normalizedAmount, tokenDecimals);
      if (BigInt(amountBaseUnits) > BigInt(walletBalance || "0")) {
        throw new Error(`Deposit amount exceeds your ${asset} wallet balance.`);
      }
      const calls = await buildDepositCalls({
        tokenSymbol: asset,
        amountBaseUnits
      });
      const execution = await executeStarknetMulticallViaStarkZap(calls.calls);
      const detail = {
        walletAddress,
        tokenSymbol: asset,
        amountBaseUnits,
        transactionHash: execution.hash,
        route: execution.route,
        callCount: execution.callCount
      };
      setResult(`Deposit submitted. StarkZap multicall ${shortHash(execution.hash)} is being watched by the agent.`);
      if (walletAddress) {
        void sendPositionAlert({
          walletAddress,
          type: "deposit_confirmed",
          title: "Deposit submitted",
          body: `BitflowOS deposit was submitted for ${asset}.`,
          transactionHash: execution.hash
        });
      }
      window.dispatchEvent(new CustomEvent("bitflowos:deposit-submitted", { detail }));
      window.dispatchEvent(new CustomEvent("bitflowos:vault-refresh", { detail }));
      window.setTimeout(() => {
        closeModal();
      }, 1100);
    } catch (error) {
      setResult((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const modal = open && typeof document !== "undefined"
    ? createPortal(
        <div className="deposit-overlay open" onClick={event => event.target === event.currentTarget ? closeModal() : undefined}>
          <div className="deposit-modal">
            <div className="m-head">
              <div className="m-head-l">
                <span className="m-icon">v</span>
                <div>
                  <div className="m-title">Deposit BTC</div>
                  <div className="m-step-label">{step === 1 ? "Step 1 of 2 - Choose asset & amount" : step === 2 ? "Step 2 of 2 - Review before signing" : "Signing transaction"}</div>
                </div>
              </div>
              <button className="m-close" aria-label="Close deposit modal" onClick={closeModal} type="button">
                <X size={16} />
              </button>
            </div>

            <div className="m-steps">
              <div className={`msd ${step > 1 ? "done" : step === 1 ? "active" : ""}`} />
              <div className={`msd ${step > 2 ? "done" : step === 2 ? "active" : ""}`} />
              <div className={`msd ${step === 3 ? "active" : ""}`} />
              <span className="ms-txt">{step === 1 ? "Asset & Amount" : step === 2 ? "Review" : "Confirm & Sign"}</span>
            </div>

            {step === 1 ? (
              <div className="m-body">
                <div className="m-src">
                  <button className={`m-src-btn ${source === "wrap" ? "act" : ""}`} onClick={() => setModalSource("wrap")} type="button">
                    <Send size={12} />
                    Wrapped BTC
                  </button>
                  <button className={`m-src-btn ${source === "native" ? "act" : ""}`} onClick={() => setModalSource("native")} type="button">
                    <Bitcoin size={12} />
                    Native BTC - Atomiq
                  </button>
                </div>

                <div className={`m-native-note ${source === "native" ? "show" : ""}`}>
                  <strong>Native Bitcoin via Atomiq bridge.</strong> Send BTC from your Bitcoin wallet. Atomiq swaps it cross-chain atomically - it arrives as SBTC and routes straight into the vault. No wrapping steps for you.
                </div>

                <div className="m-f">
                  <div className="m-flabel">Asset</div>
                  <div className="sel-wrap">
                    <button className={`sel-btn ${dropdownOpen ? "open" : ""}`} onClick={() => setDropdownOpen(value => !value)} type="button">
                      <div className="sel-btn-left">
                        <div className={`asset-dot ${selected.dot}`} />
                        <div>
                          <div className="sel-name">{asset}</div>
                          <div className="sel-proto">{selected.proto} - {selected.apy} APR</div>
                        </div>
                      </div>
                      <div className="sel-arrow">v</div>
                    </button>
                    <div className={`dropdown ${dropdownOpen ? "open" : ""}`}>
                      <div className="dd-section">Wrapped BTC</div>
                      {tokenAssets.map(symbol => {
                        const meta = getMeta(symbol);
                        return (
                          <button className="dd-item" key={symbol} onClick={() => selectAsset(symbol)} type="button">
                            <div className="dd-item-l">
                              <div className={`dd-dot ${meta.dot}`} />
                              <div>
                                <div className="dd-name">{symbol}</div>
                                <div className="dd-proto">{meta.proto}</div>
                              </div>
                            </div>
                            <div className="dd-item-r">
                              <div className="dd-apy">{meta.apy}</div>
                              <div className="dd-note">{meta.note}</div>
                            </div>
                          </button>
                        );
                      })}
                      <div className="dd-section">Native Bitcoin</div>
                      <button className="dd-item" onClick={() => selectAsset("BTC")} type="button">
                        <div className="dd-item-l">
                          <div className="dd-dot amber" />
                          <div>
                            <div className="dd-name">BTC</div>
                            <div className="dd-proto">Native Bitcoin - via Atomiq</div>
                          </div>
                        </div>
                        <div className="dd-item-r">
                          <div className="dd-apy">5.47%</div>
                          <div className="dd-note">Atomic bridge</div>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="m-f">
                  <div className="m-flabel">Amount</div>
                  <div className="m-amt">
                    <input
                      type="number"
                      value={amount}
                      placeholder={tokenDecimals === 0 ? "0" : "0.000"}
                      min="0"
                      step={tokenDecimals === 0 ? "1" : "any"}
                      onChange={event => setAmount(event.target.value)}
                    />
                    <div className="m-amt-unit">{asset}</div>
                  </div>
                  <div className="m-hint">
                    <span>Balance: {displayWalletBalance} {asset}</span>
                    <button className="ml" onClick={() => setAmount(displayWalletBalance)} type="button">USE MAX</button>
                  </div>
                </div>

                <div className="m-recv">
                  <div>
                    <div className="mrl-label">You Receive</div>
                    <div className="mrl-val">{receiveAmount}</div>
                  </div>
                  <div className="mrr">APY 5.47%<br />Price 1.0044 BTC</div>
                </div>

                <div className="m-route-info">
                  <div className="mri-row"><span className="mri-l">ROUTE</span><span className="mri-r">{route}</span></div>
                  <div className="mri-row"><span className="mri-l">GAS</span><span className="mri-r green">Sponsored by AVNU</span></div>
                  <div className="mri-row"><span className="mri-l">TIME</span><span className="mri-r">~15 seconds</span></div>
                </div>

                {result ? <div className="sign-result">{result}</div> : null}
                <button className="m-cta" onClick={reviewDeposit} type="button">Review Deposit -&gt;</button>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="m-confirm">
                <div className="mc-sum">
                  <div className="mc-row"><span className="mc-l">ASSET</span><span className="mc-r amber">{asset}</span></div>
                  <div className="mc-row"><span className="mc-l">AMOUNT</span><span className="mc-r">{formatAmount(amount)} {asset}</span></div>
                  <div className="mc-row"><span className="mc-l">YOU RECEIVE</span><span className="mc-r amber">{receiveAmount}</span></div>
                  <div className="mc-row"><span className="mc-l">SHARE PRICE</span><span className="mc-r">1.0044 BTC</span></div>
                  <div className="mc-row"><span className="mc-l">ROUTE</span><span className="mc-r">{route}</span></div>
                  <div className="mc-row"><span className="mc-l">GAS</span><span className="mc-r green">Sponsored - $0.00</span></div>
                  <div className="mc-row"><span className="mc-l">STRATEGY</span><span className="mc-r">AI-Managed - TEE Attested</span></div>
                </div>
                <div className="mc-btns">
                  <button className="m-cta sec" onClick={() => setStep(1)} type="button">Back</button>
                  <button className="m-cta" onClick={confirmAndSign} type="button">Confirm &amp; Sign -&gt;</button>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="m-body signing-body">
                <div className="sign-icon">[lock]</div>
                <div className="sign-title">Sign in Your Wallet</div>
                <div className="sign-meta">GAS SPONSORED BY AVNU - NO ETH NEEDED</div>
                {result ? <div className="sign-result">{result}</div> : null}
                {busy ? <div className="sign-result">Preparing wallet action...</div> : null}
              </div>
            ) : null}

            <div className="m-foot">
              BitflowOS does not custody assets. The smart contract vault holds all funds on-chain.
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  if (!wallet?.address) return null;

  return (
    <>
      <button className="deposit-nav-button" onClick={openModal} type="button">
        <Send size={14} />
        Deposit BTC
      </button>
      {modal}
    </>
  );
}

function getMeta(symbol: string) {
  return ASSET_META[symbol.toUpperCase()] ?? ASSET_META.LBTC;
}

function formatAmount(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed.toFixed(4) : "0.0000";
}

function formatReceive(value: string) {
  const parsed = Number.parseFloat(value) || 0;
  return parsed > 0 ? `${(parsed / 1.0044).toFixed(4)} yBTC` : "0.000 yBTC";
}

function readWalletAddress() {
  return readWalletSnapshot()?.address ?? "";
}

function decimalToBaseUnits(value: string, decimals: number) {
  const trimmed = normalizeAmountInput(value, decimals);
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Enter a valid deposit amount.");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount supports up to ${decimals} decimals for this asset.`);
  }
  const base = `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
  if (!base || BigInt(base) <= 0n) {
    throw new Error("Enter an amount greater than zero.");
  }
  return base;
}

function normalizeAmountInput(value: string, decimals: number) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (!trimmed.includes(".")) return trimmed;
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length <= decimals) return trimmed;
  if (/^0+$/.test(fraction.slice(decimals))) {
    const kept = fraction.slice(0, decimals).replace(/0+$/, "");
    return kept ? `${whole}.${kept}` : whole;
  }
  return trimmed;
}

function formatTokenUnits(value: string, decimals: number) {
  try {
    const raw = BigInt(value || "0");
    if (decimals <= 0) return raw.toString();
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const fraction = (raw % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return "0";
  }
}

function readWalletSnapshot(): WalletSnapshot {
  try {
    const raw = window.localStorage.getItem("bitflowos.connectedWallet");
    if (!raw) return null;
    return JSON.parse(raw) as WalletSnapshot;
  } catch {
    return null;
  }
}

function shortHash(hash: string) {
  return hash.length > 14 ? `${hash.slice(0, 6)}...${hash.slice(-6)}` : hash;
}
