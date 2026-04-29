const appUrl = cleanUrl(process.env.NEXT_PUBLIC_APP_URL ?? "https://bitflow-os.vercel.app");
const apiUrl = cleanUrl(process.env.NEXT_PUBLIC_API_URL ?? "https://xenacious-riva-mist-labs-29e279b2.koyeb.app");
const appName = process.env.NEXT_PUBLIC_FARCASTER_APP_NAME ?? "BitflowOS";

export function GET() {
  const miniapp = {
    version: "1",
    name: appName,
    iconUrl: `${appUrl}/icon.png`,
    homeUrl: appUrl,
    imageUrl: `${appUrl}/og.png`,
    buttonTitle: "Open BitflowOS",
    splashImageUrl: `${appUrl}/splash.png`,
    splashBackgroundColor: "#0b0f14",
    webhookUrl: `${apiUrl}/api/alerts/farcaster/webhook`,
    subtitle: "BTC Yield OS",
    description: "AI-guided BTC yield routing on Starknet with 0G verification.",
    primaryCategory: "finance",
    tags: ["btc", "yield", "starknet", "defi"],
    tagline: "BTC Yield OS",
    ogTitle: "BitflowOS",
    ogDescription: "AI-guided BTC yield routing on Starknet.",
    ogImageUrl: `${appUrl}/og.png`,
    canonicalDomain: process.env.NEXT_PUBLIC_FARCASTER_DOMAIN ?? new URL(appUrl).hostname
  };

  return Response.json({
    accountAssociation: {
      header: process.env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER ?? "",
      payload: process.env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD ?? "",
      signature: process.env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE ?? ""
    },
    miniapp,
    frame: miniapp
  });
}

function cleanUrl(value: string) {
  return value.replace(/\/+$/, "");
}
