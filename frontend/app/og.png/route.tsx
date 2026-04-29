import { ImageResponse } from "next/og";

export const runtime = "edge";

export function GET() {
  return new ImageResponse(
    <div
      style={{
        background: "#0b0f14",
        color: "#f5f7fa",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Arial, sans-serif",
        height: "100%",
        justifyContent: "center",
        padding: 72,
        width: "100%"
      }}
    >
      <div style={{ color: "#ff9812", fontSize: 34, fontWeight: 800, marginBottom: 26 }}>
        BitflowOS
      </div>
      <div style={{ fontSize: 82, fontWeight: 900, lineHeight: 1.02, maxWidth: 900 }}>
        BTC Yield OS on Starknet
      </div>
      <div style={{ color: "#a7adb7", fontSize: 34, lineHeight: 1.3, marginTop: 30, maxWidth: 850 }}>
        AI-guided allocation, StarkZap execution, and 0G verification for BTC strategies.
      </div>
    </div>,
    { height: 630, width: 1200 }
  );
}
