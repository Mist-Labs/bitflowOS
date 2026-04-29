export type MarketTickerItem = {
  name: string;
  value: string;
  change?: string;
  direction: "up" | "down" | "flat" | "syncing";
  source: string;
  updatedAt: string;
};

export class MarketDataService {
  async getTicker(): Promise<MarketTickerItem[]> {
    const updatedAt = new Date().toISOString();
    const [btc, endur] = await Promise.allSettled([
      this.fetchBtcMarket(),
      this.fetchEndurBtcApy()
    ]);

    const btcItems = btc.status === "fulfilled" ? btc.value : [];
    const endurItem = endur.status === "fulfilled" ? endur.value : null;

    return [
      ...btcItems,
      {
        name: "VESU_APR",
        value: "SYNCING",
        direction: "syncing",
        source: "Vesu public APR feed not configured",
        updatedAt
      },
      endurItem ?? {
        name: "ENDUR_APR",
        value: "SYNCING",
        direction: "syncing",
        source: "https://www.endur.fi/",
        updatedAt
      },
      {
        name: "EKUBO_APR",
        value: "SYNCING",
        direction: "syncing",
        source: "Ekubo LP APR requires pool-specific indexer data",
        updatedAt
      }
    ];
  }

  private async fetchBtcMarket(): Promise<MarketTickerItem[]> {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=btc,usd&include_24hr_change=true",
      { signal: AbortSignal.timeout(3500) }
    );
    if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);
    const json = await response.json() as { bitcoin?: { usd?: number; usd_24h_change?: number } };
    const change = json.bitcoin?.usd_24h_change;
    const changeText = typeof change === "number" ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : undefined;
    const updatedAt = new Date().toISOString();

    return ["LBTC", "WBTC", "tBTC", "SolvBTC"].map(name => ({
      name,
      value: "1.0000 BTC",
      change: changeText,
      direction: typeof change === "number" ? change >= 0 ? "up" : "down" : "flat",
      source: "https://www.coingecko.com/en/coins/bitcoin",
      updatedAt
    }));
  }

  private async fetchEndurBtcApy(): Promise<MarketTickerItem | null> {
    const response = await fetch("https://www.endur.fi/", { signal: AbortSignal.timeout(3500) });
    if (!response.ok) throw new Error(`Endur returned ${response.status}`);
    const html = await response.text();
    const match = html.match(/BTC\s*apy[\s\S]{0,160}?(\d+(?:\.\d+)?)\s*%/i)
      ?? html.match(/(\d+(?:\.\d+)?)\s*%[\s\S]{0,160}?BTC\s*apy/i);
    if (!match) return null;

    return {
      name: "ENDUR_APR",
      value: `${Number(match[1]).toFixed(2)}%`,
      change: "LIVE",
      direction: "up",
      source: "https://www.endur.fi/",
      updatedAt: new Date().toISOString()
    };
  }
}
