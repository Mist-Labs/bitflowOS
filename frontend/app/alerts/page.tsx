"use client";

import { Panel, SectionHeader } from "@/components/section";
import { getAlertPreferences, getUserProfile, setAlertPreferences } from "@/lib/api";
import { alertEvents } from "@/lib/data";
import { useEffect, useMemo, useState } from "react";

type WalletState = {
  chain: "starknet" | "bitcoin" | "privy" | "cartridge";
  label: string;
  address?: string;
} | null;

const WALLET_KEY = "bitflowos.connectedWallet";

export default function AlertsPage() {
  const [wallet, setWallet] = useState<WalletState>(null);
  const [fid, setFid] = useState<number | undefined>();
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailAddress, setEmailAddress] = useState<string | undefined>();
  const [enabled, setEnabled] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState("Connect a Starknet wallet to manage alert preferences.");

  const walletAddress = wallet?.address ?? "";
  const canSave = Boolean(walletAddress && (fid || emailEnabled));

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
    let cancelled = false;
    async function load() {
      if (!walletAddress || wallet?.chain === "bitcoin") {
        setFid(undefined);
        setSelected([]);
        setStatus("Connect a Starknet wallet to manage alert preferences.");
        return;
      }

      const [profile, preferences] = await Promise.all([
        getUserProfile(walletAddress),
        getAlertPreferences(walletAddress)
      ]);
      if (cancelled) return;
      setFid(profile.farcasterFid ?? preferences.fid);
      setEmailEnabled(Boolean(profile.emailAlertsEnabled));
      setEmailAddress(profile.emailAddress);
      setEnabled(preferences.enabled);
      setSelected(preferences.eventTypes.length ? preferences.eventTypes : alertEvents);
      if (profile.farcasterNotificationsEnabled) {
        setStatus(`Farcaster inbox alerts are live for @${profile.farcasterUsername ?? profile.farcasterFid}.`);
      } else if (profile.emailAlertsEnabled && profile.emailAddress) {
        setStatus(`Email alerts are live for ${profile.emailAddress}.`);
      } else {
        setStatus("Enable Farcaster or email alerts from Agent Terminal before saving preferences.");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, wallet?.chain]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  async function toggleEvent(event: string) {
    const next = selectedSet.has(event)
      ? selected.filter(item => item !== event)
      : [...selected, event];
    setSelected(next);
    await save(next, enabled);
  }

  async function toggleEnabled() {
    const nextEnabled = !enabled;
    setEnabled(nextEnabled);
    await save(selected, nextEnabled);
  }

  async function save(eventTypes: string[], nextEnabled: boolean) {
    if (!walletAddress || (!fid && !emailEnabled)) {
      setStatus("Enable Farcaster or email alerts from Agent Terminal before saving preferences.");
      return;
    }
    try {
      await setAlertPreferences({
        fid,
        walletAddress,
        enabled: nextEnabled,
        eventTypes
      });
      setStatus("Alert preferences saved.");
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  return (
    <>
      <SectionHeader title="Alerts" />
      <section className="two-col">
        <Panel title="Notification Events" badge={canSave ? "LIVE" : "SETUP"}>
          <div className="event-grid">
            <label className="toggle-row">
              <input checked={enabled} onChange={toggleEnabled} type="checkbox" />
              <span>Enable alerts</span>
            </label>
            {alertEvents.map(event => (
              <label className="toggle-row" key={event}>
                <input
                  checked={selectedSet.has(event)}
                  disabled={!enabled}
                  onChange={() => void toggleEvent(event)}
                  type="checkbox"
                />
                <span>{event.replaceAll("_", " ")}</span>
              </label>
            ))}
          </div>
        </Panel>
        <Panel title="Delivery Status" badge={emailEnabled ? "EMAIL" : "FARCASTER"}>
          <div className="panel-body prose-panel">
            <p>{status}</p>
            <div className="callout">
              Alerts are sent only for enabled event types. Farcaster inbox delivery is used when available; otherwise BitflowOS sends email alerts{emailAddress ? ` to ${emailAddress}` : ""}.
            </div>
          </div>
        </Panel>
      </section>
    </>
  );
}
