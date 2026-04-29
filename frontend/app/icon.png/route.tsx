import { ImageResponse } from "next/og";

export const runtime = "edge";

export function GET() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#0b0f14",
        color: "#ff9812",
        display: "flex",
        fontFamily: "Arial, sans-serif",
        height: "100%",
        justifyContent: "center",
        width: "100%"
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: "#ff9812",
          color: "#0b0f14",
          display: "flex",
          fontSize: 420,
          fontWeight: 900,
          height: 700,
          justifyContent: "center",
          width: 700
        }}
      >
        Y
      </div>
    </div>,
    { height: 1024, width: 1024 }
  );
}
