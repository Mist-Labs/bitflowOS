"use client";

import { useEffect, useState } from "react";

type TickerItem = {
  name: string;
  value: string;
  change?: string;
  direction: "up" | "down" | "flat" | "syncing";
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export function MarketTicker() {
  const [items, setItems] = useState<TickerItem[]>([
    { name: "LBTC", value: "SYNCING", direction: "syncing" },
    { name: "WBTC", value: "SYNCING", direction: "syncing" },
    { name: "tBTC", value: "SYNCING", direction: "syncing" },
    { name: "SolvBTC", value: "SYNCING", direction: "syncing" },
    { name: "VESU_APR", value: "SYNCING", direction: "syncing" },
    { name: "ENDUR_APR", value: "SYNCING", direction: "syncing" },
    { name: "EKUBO_APR", value: "SYNCING", direction: "syncing" }
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadTicker() {
      try {
        const response = await fetch(`${API_URL}/api/market/ticker`, { cache: "no-store" });
        if (!response.ok) return;
        const json = await response.json() as { items?: TickerItem[] };
        if (!cancelled && json.items?.length) setItems(json.items);
      } catch {
        // Keep explicit SYNCING state instead of rendering fake market data.
      }
    }

    void loadTicker();
    const timer = window.setInterval(loadTicker, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const loop = [...items, ...items];

  return (
    <div className="ticker-bar" aria-label="Live BTCFi market ticker">
      <div className="ticker-track">
        {loop.map((item, index) => (
          <div className="ticker-item" key={`${item.name}-${index}`}>
            <span className="name">{item.name}</span>
            <span>{item.value}</span>
            {item.change ? <span className={item.direction}>{item.change}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
