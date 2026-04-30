"use client";

import { createRecommendation, deployCapital, getUserProfile, getVaultState, mintTestToken, saveFarcasterClientSubscription, setEmailAlerts, setFarcasterUsername } from "@/lib/api";
import type { AllocationRecommendation, VaultState } from "@/lib/types";
import { Bot, SendHorizonal, TerminalSquare } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type WalletState = {
  chain: "starknet" | "bitcoin" | "privy" | "cartridge";
  label: string;
  address?: string;
} | null;

type Step = "login" | "deposit" | "watching" | "allocating" | "confirm" | "deploying" | "farcaster" | "done";
type AlertUpdateMode = "email" | "farcaster" | null;

type DepositSubmittedEvent = {
  walletAddress?: string;
  tokenSymbol?: string;
  amountBaseUnits?: string;
  transactionHash?: string;
  callCount?: number;
};

const WALLET_KEY = "bitflowos.connectedWallet";
const SESSION_KEY = "bitflowos.agentSession";
const FARCASTER_APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://bitflow-os.vercel.app";
const FARCASTER_ENABLE_GUIDE = [
  `Open BitflowOS in Farcaster: ${FARCASTER_APP_URL}`,
  "Tap Open BitflowOS in the Farcaster preview, connect the same wallet, then type `enable` here to allow inbox alerts."
];
const EMAIL_ALERT_GUIDE = "If Farcaster setup is not available, enter your email address here and I will send BitflowOS alerts there instead.";

type AgentSession = {
  walletAddress: string;
  step: "confirm";
  recommendation?: AllocationRecommendation;
  updatedAt: string;
};

export function AgentTerminal() {
  const [wallet, setWallet] = useState<WalletState>(null);
  const [step, setStep] = useState<Step>("login");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recommendation, setRecommendation] = useState<AllocationRecommendation | null>(null);
  const [depositPrompted, setDepositPrompted] = useState(false);
  const [discoveredAddress, setDiscoveredAddress] = useState("");
  const [alertUpdateMode, setAlertUpdateMode] = useState<AlertUpdateMode>(null);
  const [messages, setMessages] = useState<string[]>([
    "Hello. I am the BitflowOS allocation agent.",
    "I will check login, deposit state, strategy readiness, 0G verification, and alerts before capital moves."
  ]);

  const walletAddress = wallet?.address ?? discoveredAddress;
  const canCheckVault = Boolean(walletAddress && /^0x[0-9a-fA-F]+$/.test(walletAddress));
  const isBitcoinWallet = wallet?.chain === "bitcoin";

  useEffect(() => {
    function readWallet() {
      try {
        const stored = window.localStorage.getItem(WALLET_KEY);
        setWallet(stored ? JSON.parse(stored) as WalletState : null);
      } catch {
        setWallet(null);
      }
    }

    function onWallet(event: Event) {
      setWallet((event as CustomEvent<WalletState>).detail ?? null);
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
    function onDepositSubmitted(event: Event) {
      const detail = (event as CustomEvent<DepositSubmittedEvent>).detail ?? {};
      if (detail.walletAddress && walletAddress && detail.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) return;
      setDepositPrompted(true);
      setStep("watching");
      setMessages(current => [
        ...current,
        `Deposit submitted: ${detail.tokenSymbol ?? "BTC"} ${detail.amountBaseUnits ?? ""}${detail.transactionHash ? ` ${detail.transactionHash}` : ""}.`,
        "Watching the vault for minted yBTC shares. I will continue automatically once the deposit indexes."
      ]);
      window.dispatchEvent(new CustomEvent("bitflowos:allocation-progress", {
        detail: { stage: "deposit_submitted", txHash: detail.transactionHash, tokenSymbol: detail.tokenSymbol }
      }));
      void waitForDepositAndAllocate();
    }

    window.addEventListener("bitflowos:deposit-submitted", onDepositSubmitted);
    return () => window.removeEventListener("bitflowos:deposit-submitted", onDepositSubmitted);
  }, [walletAddress]);

  useEffect(() => {
    if (!wallet) {
      setStep("login");
      setDiscoveredAddress("");
      setRecommendation(null);
      window.dispatchEvent(new CustomEvent("bitflowos:allocation-progress", { detail: null }));
      pushOnce("You are not logged in yet. Connect a wallet, or log in with email or passkey in the top bar, then I will continue.");
      return;
    }
    setMessages(current => current.filter(message => !message.startsWith("You are not logged in yet.")));
    if (wallet.chain === "bitcoin") {
      setStep("deposit");
      pushOnce(`Connected through ${wallet.label}${wallet.address ? ` (${short(wallet.address)})` : ""}.`);
      pushOnce("Bitcoin wallet connected for native BTC intake. Connect a Starknet wallet, Privy, or Cartridge account to view vault positions and deploy capital after bridging.");
      return;
    }
    const address = wallet.address ?? discoverStarknetAddress();
    if (address && address !== wallet.address) {
      setDiscoveredAddress(address);
      const hydrated = { ...wallet, address };
      window.localStorage.setItem(WALLET_KEY, JSON.stringify(hydrated));
      window.dispatchEvent(new CustomEvent("bitflowos:wallet", { detail: hydrated }));
    }
    pushOnce(`Connected through ${wallet.label}${address ? ` (${short(address)})` : ""}.`);
    if (address && restoreAgentSession(address)) return;
    void runLoggedInChecks();
  }, [wallet?.chain, wallet?.address]);

  async function runLoggedInChecks() {
    if (!wallet) return;
    if (wallet.chain === "bitcoin") {
      setStep("deposit");
      pushOnce("Bitcoin wallet is ready for native BTC intake. I still need a Starknet vault wallet to read deposits, shares, and strategy state.");
      return;
    }
    if (!canCheckVault) {
      const address = discoverStarknetAddress();
      if (address) {
        setDiscoveredAddress(address);
        return;
      }
      setStep("deposit");
      pushOnce("Connected, but the wallet did not expose an address yet. Reconnect Ready X or choose a Starknet wallet account so I can read deposit state.");
      return;
    }

    setBusy(true);
    try {
      const state = await getVaultState(walletAddress);
      const { hasWalletBalance, hasVaultDeposit, primaryWalletAsset } = readVaultFlags(state);

      if (hasVaultDeposit) {
        await runInvestmentSequence("Vault deposit found. Starting strategy setup from live vault state.");
        return;
      }

      if (!hasWalletBalance) {
        setStep("deposit");
        setDepositPrompted(true);
        pushOnce("I do not see BTC wrapper balance or yBTC shares yet. If you need a test token, type `yes` and I will mint 1 SBTC_TEST to this wallet. Limit: 1 per address every 24 hours.");
        return;
      }

      setStep("deposit");
      setDepositPrompted(true);
      pushOnce(`I found ${primaryWalletAsset?.userWalletBalance ?? "available"} ${primaryWalletAsset?.symbol ?? "BTC"} in this wallet. Open Deposit BTC and sign the single StarkZap multicall; I will take over after it lands.`);
    } catch (error) {
      setStep("deposit");
      pushOnce(`Vault check is not ready: ${(error as Error).message}. Make the deposit from the modal and I will retry from the transaction event.`);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = input.trim();
    if (!value || busy) return;
    setMessages(current => [...current, `> ${value}`]);
    setInput("");

    if (alertUpdateMode) {
      if (alertUpdateMode === "email") {
        if (!isEmailAddress(value)) {
          pushOnce("Enter a valid email address, for example name@example.com.");
          return;
        }
        await enableEmailAlerts(value);
        setAlertUpdateMode(null);
        return;
      }
      await updateFarcasterUsername(value);
      setAlertUpdateMode(null);
      return;
    }

    const actionIntent = parsePositionAction(value);
    if (actionIntent) {
      if (!walletAddress || isBitcoinWallet) {
        pushOnce("Connect the Starknet vault wallet first so I can manage the correct position.");
        return;
      }
      pushOnce(actionIntent === "claim"
        ? `Checking claimable rewards for ${short(walletAddress)} before any wallet prompt.`
        : `Preparing to withdraw for ${short(walletAddress)}. I will route the transaction through the position controls.`);
      window.dispatchEvent(new CustomEvent("bitflowos:position-action-request", {
        detail: { action: actionIntent }
      }));
      return;
    }

    if (parseFaucetIntent(value)) {
      await requestTestToken();
      return;
    }

    const alertUpdateIntent = parseAlertUpdateIntent(value);
    if (alertUpdateIntent) {
      if (!walletAddress || isBitcoinWallet) {
        pushOnce("Connect the Starknet wallet first so I can update alerts for the correct account.");
        return;
      }
      setAlertUpdateMode(alertUpdateIntent);
      pushOnce(alertUpdateIntent === "email"
        ? "Enter the new email address for this wallet."
        : "Enter the new Farcaster username for this wallet.");
      return;
    }

    if (step === "login") {
      pushOnce("Use the Login button in the top bar first. I am watching for the wallet connection.");
      return;
    }

    if (step === "deposit") {
      if (/^(yes|y|sure|ok)$/i.test(value)) {
        await requestTestToken();
        return;
      }
      if (value.toLowerCase() === "deposited") {
        setStep("watching");
        pushOnce("Deposit noted. I am checking live vault state now.");
        await waitForDepositAndAllocate();
        return;
      }
      await runLoggedInChecks();
      return;
    }

    if (step === "watching" || step === "allocating" || step === "deploying") {
      pushOnce("I am already working through the deposit and allocation sequence. New messages will appear here as each check completes.");
      return;
    }

    if (step === "confirm") {
      if (value.toLowerCase() !== "confirm") {
        pushOnce("Please type `confirm` exactly when you are ready.");
        return;
      }
      setStep("deploying");
      setBusy(true);
      setMessages(current => [...current, "Deploying capital on-chain through the BitflowOS router executor..."]);
      await deployApprovedRecommendation();
      return;
    }

    if (step === "farcaster") {
      if (/^(enable|notify|notifications|add)$/i.test(value)) {
        await requestFarcasterNotifications();
        return;
      }
      if (isEmailAddress(value)) {
        await enableEmailAlerts(value);
        return;
      }
      if (value.toLowerCase() === "deposited") {
        setStep("watching");
        pushOnce("That looks like a deposit status, not a Farcaster handle. I am checking vault state instead.");
        await waitForDepositAndAllocate();
        return;
      }
      if (!walletAddress) {
        pushOnce("I need a Starknet wallet address to attach alerts.");
        return;
      }
      await updateFarcasterUsername(value);
    }
  }

  function pushOnce(message: string) {
    setMessages(current => current.includes(message) ? current : [...current, message]);
  }

  async function checkFarcasterAfterDeploy() {
    if (!walletAddress) {
      setBusy(false);
      setStep("farcaster");
      pushOnce("I need a Starknet wallet address to attach alerts.");
      return;
    }

    try {
      const username = await getFarcasterUsername();
      const profile = await getFarcasterProfile();
      if (profile?.emailAlertsEnabled && profile.emailAddress) {
        pushOnce(`Email alerts are live for ${profile.emailAddress}. You are set.`);
        setStep("done");
        return;
      }
      if (profile?.farcasterUsername && profile.farcasterNotificationsEnabled) {
        pushOnce(`Farcaster inbox alerts are live for @${profile.farcasterUsername}. You are set.`);
        setStep("done");
        return;
      }
      if (profile?.farcasterUsername || username) {
        const handle = profile?.farcasterUsername ?? username;
        setStep("farcaster");
        setMessages(current => [
          ...current,
          `Farcaster username @${handle} is saved, but inbox alerts are not live yet.`,
          ...FARCASTER_ENABLE_GUIDE,
          EMAIL_ALERT_GUIDE
        ]);
        return;
      }

      setStep("farcaster");
      setMessages(current => [
        ...current,
        "Alerts are not set for this wallet. Enter your Farcaster username, or enter an email address for email alerts:"
      ]);
    } catch {
      setStep("farcaster");
      setMessages(current => [
        ...current,
        "Alerts are not set for this wallet. Enter your Farcaster username, or enter an email address for email alerts:"
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function checkFarcasterReady(doneMessage: string) {
    const profile = await getFarcasterProfile();
    if (profile?.emailAlertsEnabled && profile.emailAddress) {
      pushOnce(`Email alerts are live for ${profile.emailAddress}. You are set.`);
      setStep("done");
      return;
    }
    if (profile?.farcasterUsername && profile.farcasterNotificationsEnabled) {
      pushOnce(doneMessage.replace("{username}", profile.farcasterUsername ?? ""));
      setStep("done");
      return;
    }

    setStep("farcaster");
    pushOnce("Alerts are not set for this wallet. Enter your Farcaster username, or enter an email address for email alerts:");
  }

  async function enableEmailAlerts(emailAddress: string) {
    if (!walletAddress) {
      pushOnce("Connect the Starknet wallet first so I can attach email alerts to the correct account.");
      return;
    }
    setBusy(true);
    try {
      const result = await setEmailAlerts({ walletAddress, emailAddress, enabled: true });
      setMessages(current => [...current, result.welcome, "Email alerts are attached to this wallet. You are set."]);
      setStep("done");
      clearAgentSession();
    } catch (error) {
      pushOnce((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function requestTestToken() {
    if (!walletAddress || isBitcoinWallet) {
      pushOnce("Connect a Starknet wallet first so I know where to mint the test token.");
      return;
    }

    setBusy(true);
    try {
      const result = await mintTestToken({ walletAddress });
      setMessages(current => [
        ...current,
        `Minted ${result.amount} ${result.tokenSymbol} to ${short(walletAddress)}: ${result.transactionHash}.`,
        "Open Deposit BTC and deposit the test token when it lands."
      ]);
      window.dispatchEvent(new CustomEvent("bitflowos:vault-refresh"));
      setStep("deposit");
    } catch (error) {
      pushOnce((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateFarcasterUsername(username: string) {
    if (!walletAddress) {
      pushOnce("I need a Starknet wallet address to attach alerts.");
      return;
    }
    setBusy(true);
    try {
      const result = await setFarcasterUsername({ walletAddress, farcasterUsername: username });
      if (result.farcasterNotificationsEnabled) {
        setMessages(current => [...current, result.welcome, "Farcaster inbox alerts are live for this wallet. You are set."]);
        setStep("done");
        clearAgentSession();
      } else {
        setMessages(current => [
          ...current,
          result.welcome,
          ...FARCASTER_ENABLE_GUIDE,
          EMAIL_ALERT_GUIDE
        ]);
        setStep("farcaster");
      }
    } catch (error) {
      pushOnce((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function waitForDepositAndAllocate() {
    if (!walletAddress) {
      setStep("deposit");
      pushOnce("I need the connected Starknet address before I can watch the vault.");
      return;
    }

    setBusy(true);
    try {
      for (let attempt = 1; attempt <= 12; attempt += 1) {
        const state = await getVaultState(walletAddress);
        const { hasVaultDeposit } = readVaultFlags(state);
        if (hasVaultDeposit) {
          await runInvestmentSequence("Deposit indexed. yBTC shares are visible in the vault.");
          return;
        }
        if (attempt === 1 || attempt === 5 || attempt === 10) {
          setMessages(current => [...current, `Vault indexer check ${attempt}/12: waiting for shares.`]);
        }
        await sleep(3500);
      }
      setStep("deposit");
      pushOnce("The transaction was submitted, but I do not see yBTC shares yet. If Starknet is still confirming, I will pick it up on the next refresh.");
    } finally {
      setBusy(false);
    }
  }

  async function runInvestmentSequence(startMessage: string) {
    if (!walletAddress) return;

    setBusy(true);
    setStep("allocating");
    setMessages(current => [...current, startMessage, "Loading live strategy feeds and requesting a Kimi allocation inside the 0G-verified TEE path."]);
    window.dispatchEvent(new CustomEvent("bitflowos:allocation-progress", {
      detail: { stage: "allocating", label: "TEE strategy build" }
    }));

    try {
      const rec = await createRecommendation({ walletAddress });
      setRecommendation(rec);
      setMessages(current => [...current, formatRecommendation(rec)]);
      window.dispatchEvent(new CustomEvent("bitflowos:allocation-progress", {
        detail: { stage: "recommendation_ready", recommendation: rec }
      }));

      const failedChecks = rec.riskChecks.filter(check => !check.passed);
      if (failedChecks.length) {
        setMessages(current => [...current, `Policy guardrails held: ${failedChecks.map(check => check.label).join(", ")}.`]);
      } else {
        setMessages(current => [...current, "Policy guardrails passed. Preparing router allocation targets from the approved strategy weights."]);
      }

      await sleep(700);
      setStep("confirm");
      setMessages(current => {
        const merged = [
          ...current,
          "Capital plan prepared from Kimi weights and 0G verification.",
          "Type `confirm` to submit the attestation and execute the router rebalance on-chain."
        ];
          saveAgentSession("confirm", rec);
        return merged;
      });
      window.dispatchEvent(new CustomEvent("bitflowos:allocation-progress", {
        detail: { stage: "recommendation_ready", recommendation: rec, timestamp: new Date().toISOString() }
      }));
    } catch (error) {
      setStep("deposit");
      pushOnce(`Strategy setup paused: ${(error as Error).message}.`);
    } finally {
      setBusy(false);
    }
  }

  async function deployApprovedRecommendation() {
    if (!recommendation) {
      setBusy(false);
      setStep("allocating");
      pushOnce("No approved Kimi recommendation is available yet. I need to rebuild the plan before deployment.");
      return;
    }

    try {
      const result = await deployCapital({ recommendation });
      if (result.status === "skipped") {
        setMessages(current => {
          const merged = [...current, result.message];
          clearAgentSession();
          return merged;
        });
      } else {
        setMessages(current => {
          const merged = [
            ...current,
            `Router rebalance submitted: ${result.transactionHash ?? "transaction hash pending"}.`,
            `Attestation ${short(result.attestationHash ?? "")} accepted for ${result.weights.map(item => `${item.label} ${Math.round(item.targetBps / 100)}%`).join(", ")}.`,
            ...(result.skippedWeights?.length
              ? [`Gated routes stayed idle: ${result.skippedWeights.map(item => `${item.label} ${Math.round(item.targetBps / 100)}% (${item.reason})`).join(", ")}.`]
              : [])
          ];
          clearAgentSession();
          return merged;
        });
      }
      window.dispatchEvent(new CustomEvent("bitflowos:allocation-progress", {
        detail: { stage: "plan_staged", recommendation, timestamp: new Date().toISOString(), txHash: result.transactionHash }
      }));
      window.dispatchEvent(new CustomEvent("bitflowos:vault-refresh"));
      await checkFarcasterAfterDeploy();
    } catch (error) {
      setStep("confirm");
      pushOnce(`Capital deployment failed before completion: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function getFarcasterUsername() {
    return (await getFarcasterProfile())?.farcasterUsername ?? "";
  }

  async function getFarcasterProfile(): Promise<Awaited<ReturnType<typeof getUserProfile>> | undefined> {
    if (!walletAddress) return undefined;
    try {
      return await getUserProfile(walletAddress);
    } catch {
      return undefined;
    }
  }

  async function requestFarcasterNotifications() {
    if (!walletAddress) {
      pushOnce("Connect the Starknet wallet first so I can attach Farcaster alerts to the correct account.");
      return;
    }

    setBusy(true);
    try {
      const { sdk } = await import("@farcaster/miniapp-sdk");
      const inMiniApp = await sdk.isInMiniApp();
      if (!inMiniApp) {
        setMessages(current => [...current, ...[...FARCASTER_ENABLE_GUIDE, EMAIL_ALERT_GUIDE].filter(message => !current.includes(message))]);
        return;
      }
      const context = await sdk.context;
      const response = await sdk.actions.addMiniApp();
      if (!response.notificationDetails) {
        pushOnce("BitflowOS was added, but Farcaster did not return notification permissions. Enable notifications for BitflowOS in Farcaster, then try again.");
        return;
      }
      await saveFarcasterClientSubscription({
        walletAddress,
        fid: context.user.fid,
        username: context.user.username,
        notificationDetails: response.notificationDetails
      });
      setMessages(current => [...current, `Farcaster inbox alerts are live for @${context.user.username ?? context.user.fid}. You are set.`]);
      setStep("done");
      clearAgentSession();
    } catch (error) {
      pushOnce(`Farcaster notifications are not enabled yet: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function restoreAgentSession(address: string) {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const session = JSON.parse(raw) as AgentSession;
      const isSameWallet = session.walletAddress.toLowerCase() === address.toLowerCase();
      const isFresh = Date.now() - new Date(session.updatedAt).getTime() < 60 * 60 * 1000;
      if (!isSameWallet || !isFresh) return false;
      setRecommendation(session.recommendation ?? null);
      setStep(session.step);
      setMessages(current => [
        ...current,
        `Connected through ${wallet?.label ?? "wallet"} (${short(address)}).`,
        "A prepared capital plan is waiting for your confirmation.",
        "Type `confirm` to submit the attestation and execute the router rebalance on-chain."
      ]);
      if (session.recommendation) {
        window.dispatchEvent(new CustomEvent("bitflowos:allocation-progress", {
          detail: {
            stage: session.step === "confirm" ? "recommendation_ready" : "plan_staged",
            recommendation: session.recommendation,
            timestamp: session.updatedAt
          }
        }));
      }
      return true;
    } catch {
      return false;
    }
  }

  function saveAgentSession(nextStep: "confirm", rec: AllocationRecommendation | null) {
    if (!walletAddress) return;
    const session: AgentSession = {
      walletAddress,
      step: nextStep,
      recommendation: rec ?? undefined,
      updatedAt: new Date().toISOString()
    };
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearAgentSession() {
    window.localStorage.removeItem(SESSION_KEY);
  }

  const prompt = useMemo(() => {
    if (step === "login") return "waiting for login";
    if (step === "deposit") return "open deposit modal";
    if (step === "watching") return "watching vault";
    if (step === "allocating") return "allocating";
    if (step === "confirm") return "type confirm";
    if (alertUpdateMode === "email") return "new email";
    if (alertUpdateMode === "farcaster") return "new username";
    if (step === "farcaster") return "username or email";
    if (step === "done") return "ask for action";
    return "deploying";
  }, [step]);

  return (
    <aside className="agent-terminal" aria-label="BitflowOS guided agent terminal">
      <div className="agent-head">
        <span><TerminalSquare size={16} /> Agent Terminal</span>
        <strong>{busy ? "WORKING" : step.toUpperCase()}</strong>
      </div>
      <div className="agent-log">
        {messages.map((message, index) => (
          <p key={`${message}-${index}`}>
            {message.startsWith(">") ? null : <Bot size={13} />}
            <span>{renderAgentMessage(message)}</span>
          </p>
        ))}
      </div>
      {recommendation?.attestation.setupRequired?.length ? (
        <div className="agent-setup">
          0G verifier setup needed: {recommendation.attestation.setupRequired.join(" ")}
        </div>
      ) : null}
      <form className="agent-input" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder={prompt}
          disabled={busy}
        />
        <button type="submit" disabled={busy} aria-label="Send command">
          <SendHorizonal size={15} />
        </button>
      </form>
    </aside>
  );
}

function isEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function formatRecommendation(recommendation: AllocationRecommendation): string {
  const weights = recommendation.weights
    .map(item => `${item.label}: ${Math.round(item.targetBps / 100)}%`)
    .join(", ");
  const verified = recommendation.attestation.verified ? "0G verified" : "0G verification pending";
  return `Strategy ready for ${recommendation.assetSymbol}. ${weights}. Confidence ${Math.round(recommendation.confidenceBps / 100)}%. ${verified}.`;
}

function short(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function renderAgentMessage(message: string): ReactNode {
  const hashPattern = /(0x[0-9a-fA-F]{16,})/g;
  const parts = message.split(hashPattern);
  return parts.map((part, index) => {
    if (!/^0x[0-9a-fA-F]{16,}$/.test(part)) return part;
    return (
      <a
        key={`${part}-${index}`}
        className="agent-tx-link"
        href={`https://sepolia.voyager.online/tx/${part}`}
        target="_blank"
        rel="noreferrer"
      >
        {short(part)}
      </a>
    );
  });
}

function parsePositionAction(value: string): "claim" | "withdraw" | null {
  const normalized = value.toLowerCase();
  if (/\b(claim|harvest|rewards?)\b/.test(normalized)) return "claim";
  if (/\b(withdraw|exit|redeem|unstake)\b/.test(normalized)) return "withdraw";
  return null;
}

function parseFaucetIntent(value: string): boolean {
  return /\b(faucet|mint|test token|sbtc_test|sbtc test)\b/i.test(value);
}

function parseAlertUpdateIntent(value: string): AlertUpdateMode {
  const normalized = value.toLowerCase();
  if (/\b(change|update|edit|replace|set)\b.*\b(email|mail)\b/.test(normalized)) return "email";
  if (/\b(change|update|edit|replace|set)\b.*\b(farcaster|username|handle)\b/.test(normalized)) return "farcaster";
  if (/\b(email|mail)\b.*\b(change|update|edit|replace|set)\b/.test(normalized)) return "email";
  if (/\b(farcaster|username|handle)\b.*\b(change|update|edit|replace|set)\b/.test(normalized)) return "farcaster";
  return null;
}

function discoverStarknetAddress() {
  if (typeof window === "undefined") return "";
  const candidate = window as unknown as {
    starknet?: { selectedAddress?: string; account?: { address?: string } };
    starknet_argentX?: { selectedAddress?: string; account?: { address?: string } };
    starknet_braavos?: { selectedAddress?: string; account?: { address?: string } };
  };
  return candidate.starknet?.selectedAddress
    ?? candidate.starknet?.account?.address
    ?? candidate.starknet_argentX?.selectedAddress
    ?? candidate.starknet_argentX?.account?.address
    ?? candidate.starknet_braavos?.selectedAddress
    ?? candidate.starknet_braavos?.account?.address
    ?? "";
}

function readVaultFlags(state: VaultState) {
  const primaryWalletAsset = state.assets.find(asset => toBigInt(asset.userWalletBalance) > 0n);
  return {
    hasWalletBalance: Boolean(primaryWalletAsset),
    hasVaultDeposit: state.assets.some(asset => toBigInt(asset.userShares) > 0n || toBigInt(asset.userAssetShares) > 0n),
    primaryWalletAsset
  };
}

function toBigInt(value?: string) {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}
