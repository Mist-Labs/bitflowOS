"use client";

import { Check, KeyRound, Mail, Wallet } from "lucide-react";
import type { WalletOption } from "@/lib/types";
import { useState } from "react";

const icons = {
  "connect-wallet": Wallet,
  privy: Mail,
  cartridge: KeyRound
};

export function WalletOnboarding({ options }: { options: WalletOption[] }) {
  const [selected, setSelected] = useState(options[0]?.id ?? "connect-wallet");

  return (
    <div className="wallet-grid">
      {options.map(option => {
        const Icon = icons[option.id] ?? Wallet;
        const active = selected === option.id;
        return (
          <button
            className={`wallet-option ${active ? "selected" : ""}`}
            key={option.id}
            onClick={() => setSelected(option.id)}
            type="button"
          >
            <span className="wallet-icon">
              <Icon size={18} />
            </span>
            <strong>{option.label}</strong>
            <small>{option.recommendedFor}</small>
            <span className="wallet-status">
              {option.enabled === false ? "CONFIG NEEDED" : active ? "SELECTED" : "AVAILABLE"}
              {active ? <Check size={14} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
