"use client";

import { buildDepositCalls, buildWithdrawCall, createBridgeIntent } from "@/lib/api";
import type { TokenConfig, VaultState } from "@/lib/types";
import { Bitcoin, Copy, Send, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";

export function DepositFlow({ tokens, vaultState }: { tokens: TokenConfig[]; vaultState?: VaultState }) {
  const [mode, setMode] = useState<"native" | "wallet">("native");
  const [walletAction, setWalletAction] = useState<"deposit" | "withdraw">("deposit");
  const [token, setToken] = useState(tokens[0]?.symbol ?? "WBTC");
  const [amount, setAmount] = useState("10000");
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const selectedToken = useMemo(
    () => tokens.find(item => item.symbol === token) ?? tokens[0],
    [token, tokens]
  );
  const selectedAssetState = vaultState?.assets.find(item => item.symbol === token);
  const selectedStrategyState = vaultState?.strategies.find(item => item.assetSymbol === token);

  async function submitBridge() {
    setBusy(true);
    setResult("");
    try {
      const intent = await createBridgeIntent({
        amountSats: amount,
        destinationAddress: address,
        outputToken: token,
        source: "BTC"
      });
      setResult(`Atomiq quote ${intent.id}: send BTC to ${intent.paymentAddress ?? "quoted address"}`);
    } catch (error) {
      setResult((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitDepositCalls() {
    setBusy(true);
    setResult("");
    try {
      const calls = await buildDepositCalls({
        tokenSymbol: token,
        amountBaseUnits: amount
      });
      setResult(`Prepared ${calls.calls.length} wallet calls for ${token}: approve then deposit.`);
    } catch (error) {
      setResult((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitWithdrawCall() {
    setBusy(true);
    setResult("");
    try {
      const call = await buildWithdrawCall({
        tokenSymbol: token,
        sharesBaseUnits: amount
      });
      setResult(`Prepared withdrawal call for ${token}: ${call.call.entrypoint}.`);
    } catch (error) {
      setResult((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="deposit-grid">
      <div className="segmented">
        <button className={mode === "native" ? "active" : ""} onClick={() => setMode("native")} type="button">
          <Bitcoin size={16} />
          Native BTC
        </button>
        <button className={mode === "wallet" ? "active" : ""} onClick={() => setMode("wallet")} type="button">
          <Send size={16} />
          Wrapped BTC
        </button>
      </div>

      <div className="asset-selector">
        {tokens.map(item => (
          <button
            className={`asset-btn ${item.symbol === token ? "selected" : ""}`}
            key={item.symbol}
            onClick={() => setToken(item.symbol)}
            type="button"
          >
            {item.symbol}
          </button>
        ))}
      </div>

      <label className="field">
        <span>{mode === "native" ? "BTC amount in sats" : `${selectedToken?.symbol ?? token} base units`}</span>
        <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="numeric" />
      </label>

      {mode === "native" ? (
        <label className="field">
          <span>Destination Starknet wallet</span>
          <input value={address} onChange={event => setAddress(event.target.value)} placeholder="0x..." />
        </label>
      ) : null}

      {mode === "wallet" ? (
        <div className="segmented compact">
          <button className={walletAction === "deposit" ? "active" : ""} onClick={() => setWalletAction("deposit")} type="button">
            <Send size={16} />
            Deposit
          </button>
          <button className={walletAction === "withdraw" ? "active" : ""} onClick={() => setWalletAction("withdraw")} type="button">
            <Undo2 size={16} />
            Withdraw
          </button>
        </div>
      ) : null}

      <div className="output-info">
        <span>Route</span>
        <strong>{mode === "native" ? "BTC -> Atomiq -> Wallet -> Vault" : `${walletAction === "deposit" ? "Wallet -> Vault" : "Vault -> Wallet"}`}</strong>
      </div>

      <div className="output-info">
        <span>Live State</span>
        <strong>
          {selectedAssetState
            ? `${selectedAssetState.supported ? "SUPPORTED" : "NOT ENABLED"} / strategy ${selectedStrategyState?.configured ? "READY" : "PENDING"}`
            : "SYNCING"}
        </strong>
      </div>

      <button
        className="deposit-button"
        disabled={busy || (mode === "native" && !address)}
        onClick={mode === "native" ? submitBridge : walletAction === "deposit" ? submitDepositCalls : submitWithdrawCall}
        type="button"
      >
        {busy ? "Preparing..." : mode === "native" ? "Create Atomiq Quote" : walletAction === "deposit" ? "Prepare Deposit Calls" : "Prepare Withdrawal Call"}
      </button>

      {result ? (
        <div className="result-box">
          <Copy size={14} />
          {result}
        </div>
      ) : null}
    </div>
  );
}
