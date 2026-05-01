"use client";

import { Bitcoin, ChevronDown, KeyRound, Mail, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBitflowAuth } from "./providers";
import {
  clearRuntimeStarknetWallet,
  discoverInjectedStarknetWallets,
  setRuntimeStarknetWallet,
} from "@/lib/starknet-wallet-runtime";
import { getPrivyStarknetWallet, getStarkZapConfig } from "@/lib/api";

type Step = "root" | "chain" | "starknet" | "bitcoin";
type ConnectedWallet = {
  chain: "starknet" | "bitcoin" | "privy" | "cartridge";
  label: string;
  address?: string;
};

const STORAGE_KEY = "bitflowos.connectedWallet";
const EXPECTED_APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL
  ? safeOrigin(process.env.NEXT_PUBLIC_APP_URL)
  : "";

function formatAddress(address?: string) {
  if (!address) return "";
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-5)}`;
}

function normalizeAddress(address?: string) {
  if (!address) return undefined;
  const trimmed = address.trim();
  return trimmed || undefined;
}

function discoverStarknetAddress() {
  if (typeof window === "undefined") return undefined;
  const wallets = discoverInjectedStarknetWallets();
  const wallet = wallets[0];
  return normalizeAddress(wallet?.selectedAddress ?? wallet?.account?.address);
}

function extractBitcoinAccounts(result: unknown): Array<{ address?: string }> {
  const payload = result as {
    status?: "success" | "error";
    result?:
      | Array<{ address?: string }>
      | { addresses?: Array<{ address?: string }> };
    addresses?: Array<{ address?: string }>;
  };
  if (payload.status === "error") return [];
  if (Array.isArray(payload.result)) return payload.result;
  if (payload.result && "addresses" in payload.result)
    return payload.result.addresses ?? [];
  return payload.addresses ?? [];
}

export function LoginMenu() {
  const {
    authenticated,
    loginWithPrivy,
    logoutPrivy,
    privyConfigured,
    privyReady,
    privyUserId,
    privyError,
  } = useBitflowAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("root");
  const [status, setStatus] = useState("Choose a login method");
  const [connectedWallet, setConnectedWallet] =
    useState<ConnectedWallet | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastPrivyUserRef = useRef("");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const wallet = JSON.parse(stored) as ConnectedWallet;
        const address = wallet.address ?? discoverStarknetAddress();
        const hydrated = address ? { ...wallet, address } : wallet;
        setConnectedWallet(hydrated);
        if (address && !wallet.address) {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hydrated));
          window.dispatchEvent(
            new CustomEvent("bitflowos:wallet", { detail: hydrated }),
          );
        }
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (
      !authenticated ||
      !privyUserId ||
      lastPrivyUserRef.current === privyUserId
    )
      return;
    lastPrivyUserRef.current = privyUserId;
    void connectPrivyThroughStarkZap(privyUserId);
  }, [authenticated, privyUserId]);

  useEffect(() => {
    if (privyError) setStatus(privyError);
  }, [privyError]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
        setStep("root");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  async function connectStarknetWallet() {
    setStatus("Opening Starknet wallet selector...");
    try {
      const { connect } = await import("@starknet-io/get-starknet");
      const wallet = await connect({ modalMode: "alwaysAsk" } as never);
      if (!wallet) {
        setStatus("No Starknet wallet selected");
        return;
      }
      const enabled = await (
        wallet as unknown as { enable?: () => Promise<string[]> }
      ).enable?.();
      const requested = await (
        wallet as unknown as {
          request?: (input: { type: string }) => Promise<string[]>;
        }
      )
        .request?.({
          type: "wallet_requestAccounts",
        })
        .catch(() => undefined);
      const address = normalizeAddress(
        (
          wallet as unknown as {
            selectedAddress?: string;
            account?: { address?: string };
          }
        ).selectedAddress ??
          (wallet as unknown as { account?: { address?: string } }).account
            ?.address ??
          requested?.[0] ??
          enabled?.[0],
      );
      setRuntimeStarknetWallet(wallet as never);
      setWallet({
        chain: "starknet",
        label: wallet.name ?? "Starknet wallet",
        address,
      });
      setStatus(`Connected ${wallet.name ?? "Starknet wallet"}`);
      setOpen(false);
      setStep("root");
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function connectBitcoinWallet() {
    setStatus("Requesting Bitcoin wallet addresses...");
    try {
      const satsConnect = await import("sats-connect");
      const walletApi = satsConnect.default;
      if (typeof walletApi.request !== "function") {
        throw new Error("BITCOIN_WALLET_UNAVAILABLE");
      }
      const request = walletApi.request.bind(walletApi);
      const { AddressPurpose, BitcoinNetworkType } = satsConnect;
      const params = {
        permissions: [
          {
            type: "account" as const,
            resourceId: "account",
            actions: { read: true },
          },
          {
            type: "wallet" as const,
            resourceId: "wallet",
            actions: { readNetwork: true },
          },
        ],
        addresses: [AddressPurpose.Payment, AddressPurpose.Ordinals],
        message: "Connect BTC address",
        network: BitcoinNetworkType.Testnet,
      };
      const result = await request("wallet_connect", params)
        .catch(async () => request("wallet_getAccount", null))
        .catch(async () =>
          request("getAccounts", {
            purposes: [AddressPurpose.Payment, AddressPurpose.Ordinals],
            message: "Connect BTC address",
          }),
        );
      const accounts = extractBitcoinAccounts(result);
      if (!accounts[0]?.address) {
        throw new Error("BITCOIN_WALLET_UNAVAILABLE");
      }
      setWallet({
        chain: "bitcoin",
        label: "Bitcoin wallet",
        address: accounts[0]?.address,
      });
      setStatus("Bitcoin wallet connected");
      setOpen(false);
      setStep("root");
    } catch (error) {
      setStatus(formatBitcoinWalletError(error));
    }
  }

  function choosePrivy() {
    const preflightError = getLoginContextProblem("Privy email login");
    if (preflightError) {
      setStatus(preflightError);
      return;
    }
    const originError = getExpectedOriginProblem();
    if (originError) {
      setStatus(originError);
      return;
    }
    if (!privyConfigured) {
      setStatus(
        "Privy app id is missing. Set NEXT_PUBLIC_PRIVY_APP_ID in the frontend env.",
      );
      return;
    }
    if (!privyReady) {
      setStatus("Privy is still loading.");
      return;
    }
    setStatus("Opening StarkZap Privy login...");
    loginWithPrivy();
    setOpen(false);
  }

  async function chooseCartridge() {
    const preflightError = getLoginContextProblem("Cartridge passkey");
    if (preflightError) {
      setStatus(preflightError);
      return;
    }
    const originError = getExpectedOriginProblem();
    if (originError) {
      setStatus(originError);
      return;
    }
    setStatus("Opening StarkZap Cartridge passkey...");
    try {
      const config = await getStarkZapConfig();
      const cartridge = (
        config.walletEntryPoints as Array<{
          id: string;
          policies?: { target: string; method: string }[];
        }>
      ).find((item) => item.id === "cartridge");
      const { StarkZap, OnboardStrategy } = await import("starkzap");
      const sdk = new StarkZap({
        network: (config.network ||
          process.env.NEXT_PUBLIC_STARKNET_NETWORK ||
          "sepolia") as "mainnet" | "sepolia",
        rpcUrl: config.rpcUrl || process.env.NEXT_PUBLIC_STARKNET_RPC_URL,
      });
      const onboarded = await sdk.onboard({
        strategy: OnboardStrategy.Cartridge,
        deploy: "if_needed",
        cartridge: {
          policies: cartridge?.policies ?? [],
        },
        feeMode: { type: "paymaster" },
      });
      const address = String(onboarded.wallet.address);
      const username = await onboarded.wallet.username?.();
      setRuntimeStarknetWallet({
        id: "starkzap-cartridge",
        name: "StarkZap Cartridge",
        selectedAddress: address,
        account: {
          address,
          execute: async (calls) => {
            const tx = await onboarded.wallet.execute(calls as never);
            return { transaction_hash: tx.hash };
          },
        },
      });
      setWallet({
        chain: "cartridge",
        label: username ? `Cartridge ${username}` : "StarkZap Cartridge",
        address,
      });
      setStatus(`Connected StarkZap Cartridge ${formatAddress(address)}`);
      setOpen(false);
      setStep("root");
    } catch (error) {
      setStatus(formatCartridgeStarkZapError(error));
    }
  }

  function setWallet(wallet: ConnectedWallet) {
    setConnectedWallet(wallet);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
    window.dispatchEvent(
      new CustomEvent("bitflowos:wallet", { detail: wallet }),
    );
  }

  async function connectPrivyThroughStarkZap(userId: string) {
    setStatus("Preparing StarkZap Privy wallet...");
    try {
      const walletConfig = await getPrivyStarknetWallet({ userId });
      const { StarkZap, OnboardStrategy } = await import("starkzap");
      const sdk = new StarkZap({
        network: (process.env.NEXT_PUBLIC_STARKNET_NETWORK ?? "sepolia") as
          | "mainnet"
          | "sepolia",
        rpcUrl: process.env.NEXT_PUBLIC_STARKNET_RPC_URL,
      });
      const onboarded = await sdk.onboard({
        strategy: OnboardStrategy.Privy,
        deploy: "if_needed",
        privy: {
          resolve: async () => ({
            walletId: walletConfig.walletId,
            publicKey: walletConfig.publicKey,
            serverUrl: walletConfig.serverUrl,
            metadata: { address: walletConfig.address },
          }),
        },
      });
      const address = String(onboarded.wallet.address);
      setRuntimeStarknetWallet({
        id: "starkzap-privy",
        name: "StarkZap Privy",
        selectedAddress: address,
        account: {
          address,
          execute: async (calls) => {
            const tx = await onboarded.wallet.execute(calls as never);
            return { transaction_hash: tx.hash };
          },
        },
      });
      setWallet({
        chain: "privy",
        label: "StarkZap Privy",
        address,
      });
      setStatus(`Connected StarkZap Privy ${formatAddress(address)}`);
    } catch (error) {
      lastPrivyUserRef.current = "";
      setStatus(formatPrivyStarkZapError(error));
    }
  }

  async function disconnectWallet() {
    if (connectedWallet?.chain === "privy" && authenticated) {
      await logoutPrivy();
    }
    window.localStorage.removeItem(STORAGE_KEY);
    clearRuntimeStarknetWallet();
    setConnectedWallet(null);
    setStatus("Disconnected");
    setStep("root");
    window.dispatchEvent(new CustomEvent("bitflowos:wallet", { detail: null }));
  }

  return (
    <div className="login-menu" ref={menuRef}>
      <button
        className={`login-trigger ${connectedWallet ? "connected" : ""}`}
        onClick={() => {
          setOpen(!open);
          setStep("root");
        }}
        type="button"
      >
        {connectedWallet ? (
          <span className="connected-label">
            <strong>
              {connectedWallet.address
                ? formatAddress(connectedWallet.address)
                : connectedWallet.label}
            </strong>
            <small>{connectedWallet.label}</small>
          </span>
        ) : (
          "Login"
        )}
        <ChevronDown size={14} />
      </button>

      {open ? (
        <div className="login-popover">
          <div className="login-popover-head">
            <strong>
              {step === "root"
                ? "Access BitflowOS"
                : step === "chain"
                  ? "Choose Wallet Chain"
                  : step === "starknet"
                    ? "Starknet Wallets"
                    : "Bitcoin Wallets"}
            </strong>
            <button
              aria-label="Close login menu"
              onClick={() => {
                setOpen(false);
                setStep("root");
              }}
              type="button"
            >
              <X size={14} />
            </button>
          </div>

          {connectedWallet ? (
            <div className="wallet-kit-panel">
              <p>
                Connected through {connectedWallet.chain}
                {connectedWallet.address ? `: ${connectedWallet.address}` : "."}
              </p>
              <button
                className="kit-button secondary-kit"
                onClick={disconnectWallet}
                type="button"
              >
                Disconnect
              </button>
            </div>
          ) : null}

          {step === "root" && !connectedWallet ? (
            <div className="login-options">
              <button onClick={() => setStep("chain")} type="button">
                <Wallet size={17} />
                <span>
                  Connect Wallet
                  <small>Starknet or Bitcoin wallet</small>
                </span>
              </button>
              <button onClick={choosePrivy} type="button">
                <Mail size={17} />
                <span>
                  Continue with Email
                  <small>Privy embedded wallet</small>
                </span>
              </button>
              <button onClick={chooseCartridge} type="button">
                <KeyRound size={17} />
                <span>
                  Continue with Passkey
                  <small>Cartridge session wallet</small>
                </span>
              </button>
            </div>
          ) : null}

          {step === "chain" && !connectedWallet ? (
            <div className="login-options">
              <button onClick={connectStarknetWallet} type="button">
                <Wallet size={17} />
                <span>
                  Starknet
                  <small>Argent, Braavos, compatible wallets</small>
                </span>
              </button>
              <button onClick={connectBitcoinWallet} type="button">
                <Bitcoin size={17} />
                <span>
                  Bitcoin
                  <small>Install Xverse or UniSat to connect native BTC</small>
                </span>
              </button>
            </div>
          ) : null}

          <div
            className={`login-status ${isWarningStatus(status) ? "warning" : ""}`}
          >
            {status}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatBitcoinWalletError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (/rejected|denied|cancel/i.test(raw)) {
    return "Bitcoin wallet connection was cancelled.";
  }
  if (
    /BITCOIN_WALLET_UNAVAILABLE|isProviderSet|undefined|provider|not found/i.test(
      raw,
    )
  ) {
    return "No compatible Bitcoin wallet was detected. Install or unlock Xverse or UniSat, then try again.";
  }
  return "Bitcoin wallet connection could not be completed. Open Xverse or UniSat and try again.";
}

function formatPrivyStarkZapError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (/not configured|PRIVY_APP/i.test(raw)) {
    return "StarkZap Privy is not configured on the backend yet.";
  }
  if (/401|403|unauthorized|forbidden/i.test(raw)) {
    return "StarkZap Privy could not authorize this app. Check Privy credentials before deployment.";
  }
  return "StarkZap Privy wallet setup could not be completed. Please try again.";
}

function formatCartridgeStarkZapError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (/popup|allowed/i.test(raw)) {
    return "Cartridge could not open. Allow popups for this site, then try again.";
  }
  if (/preset|polic/i.test(raw)) {
    return "Cartridge session policies are not ready. Check the StarkZap Cartridge policy setup.";
  }
  if (/controller|install|module/i.test(raw)) {
    return "StarkZap Cartridge is not available in this build. Install the Cartridge controller package.";
  }
  return "StarkZap Cartridge passkey setup could not be completed. Please try again.";
}

function isWarningStatus(value: string) {
  return /No compatible Bitcoin|could not|not available|cancelled|missing|failed|try again|not configured|requires|origin|certificate|http:\/\/localhost|https/i.test(
    value,
  );
}

function getLoginContextProblem(label: string) {
  if (typeof window === "undefined") return "";
  const { protocol, hostname, origin } = window.location;
  const localhost = hostname === "localhost" || hostname === "127.0.0.1";
  if (protocol === "https:" && localhost) {
    return `${label} requires a clean browser security context. Open ${EXPECTED_APP_ORIGIN || "http://localhost:3000"} instead of ${origin}.`;
  }
  if (!window.isSecureContext && !localhost) {
    return `${label} requires HTTPS with a valid certificate. Deploy to HTTPS or use http://localhost for local testing.`;
  }
  return "";
}

function getExpectedOriginProblem() {
  if (typeof window === "undefined" || !EXPECTED_APP_ORIGIN) return "";
  if (window.location.origin === EXPECTED_APP_ORIGIN) return "";
  return `Origin mismatch: open ${EXPECTED_APP_ORIGIN}, or add ${window.location.origin} to the Privy allowed origins and Cartridge passkey domain setup.`;
}

function safeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}
