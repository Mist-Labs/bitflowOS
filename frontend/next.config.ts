import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  webpack: config => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
      "@fatsolutions/tongo-sdk": false,
      "@hyperlane-xyz/registry": false,
      "@hyperlane-xyz/sdk": false,
      "@hyperlane-xyz/utils": false
    };
    return config;
  }
};

export default nextConfig;
