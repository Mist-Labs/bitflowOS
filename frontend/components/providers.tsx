"use client";

import { createContext, useContext, useState } from "react";
import { PrivyProvider, useLogin, usePrivy, useWallets } from "@privy-io/react-auth";

type BitflowAuth = {
  privyReady: boolean;
  privyConfigured: boolean;
  authenticated: boolean;
  privyUserId?: string;
  privyWallet?: { address?: string };
  privyError?: string;
  loginWithPrivy: () => void;
  logoutPrivy: () => Promise<void>;
};

const AuthContext = createContext<BitflowAuth>({
  privyReady: false,
  privyConfigured: false,
  authenticated: false,
  privyUserId: "",
  privyError: "",
  loginWithPrivy: () => undefined,
  logoutPrivy: async () => undefined
});

export function useBitflowAuth() {
  return useContext(AuthContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return (
      <AuthContext.Provider value={{
        privyReady: true,
        privyConfigured: false,
        authenticated: false,
        privyUserId: "",
        privyError: "",
        loginWithPrivy: () => undefined,
        logoutPrivy: async () => undefined
      }}>
        {children}
      </AuthContext.Provider>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#f5b84b",
          logo: undefined
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets"
          }
        }
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

function PrivyBridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const [privyError, setPrivyError] = useState("");
  const { login } = useLogin({
    onComplete: () => setPrivyError(""),
    onError: error => {
      setPrivyError(formatPrivyError(error));
    }
  });
  const walletAddress = wallets[0]?.address ?? user?.wallet?.address;
  const wallet = walletAddress ? { address: walletAddress } : undefined;

  return (
    <AuthContext.Provider value={{
      privyReady: ready,
      privyConfigured: true,
      authenticated,
      privyUserId: user?.id,
      privyWallet: wallet,
      privyError,
      loginWithPrivy: login,
      logoutPrivy: logout
    }}>
      {children}
    </AuthContext.Provider>
  );
}

function formatPrivyError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (/popup|closed|cancel/i.test(raw)) {
    return "Email login was closed before it finished.";
  }
  if (/origin|domain|redirect|unauthorized|app/i.test(raw)) {
    return "Email login is not available for this app URL yet. Check the Privy dashboard allowed domains and app id.";
  }
  if (/network|fetch|timeout/i.test(raw)) {
    return "Email login could not reach Privy. Check your connection and try again.";
  }
  return "Email login could not be completed. Please try again, or connect a Starknet wallet.";
}
