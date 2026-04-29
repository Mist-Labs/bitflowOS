import Link from "next/link";
import { headers } from "next/headers";
import {
  Bell,
  BrainCircuit,
  Gauge,
  Settings,
  WalletCards,
  Waypoints
} from "lucide-react";
import { LoginMenu } from "./login-menu";
import { MarketTicker } from "./market-ticker";
import { DepositModal } from "./deposit-modal";
import { getAppConfig, getVaultState } from "@/lib/api";

const nav = [
  { href: "/", label: "Dashboard", icon: Gauge },
  { href: "/deposit", label: "Deposit", icon: WalletCards },
  { href: "/strategies", label: "Strategies", icon: Waypoints },
  { href: "/ai", label: "AI Policy", icon: BrainCircuit },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings }
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const pathname = headerList.get("x-next-pathname") ?? "";
  const [config, vaultState] = await Promise.all([
    getAppConfig(),
    getVaultState()
  ]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="logo" aria-label="BitflowOS home">
          <span className="logo-icon">Y</span>
          <span>
            <strong>BitflowOS</strong>
            <small>BTC YIELD OS</small>
          </span>
        </Link>
        <nav className="nav" aria-label="Primary navigation">
          <p className="nav-label">Operate</p>
          {nav.slice(0, 4).map(item => (
            <Link
              className={`nav-item ${pathname === item.href ? "active" : ""}`}
              href={item.href}
              key={item.href}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
            </Link>
          ))}
          <p className="nav-label">User</p>
          {nav.slice(4).map(item => (
            <Link
              className={`nav-item ${pathname === item.href ? "active" : ""}`}
              href={item.href}
              key={item.href}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-deposit">
          <DepositModal tokens={config.tokens} vaultState={vaultState} />
        </div>
        <div className="sidebar-footer">
          <div className="status-pill">
            <span className="status-dot" />
            TEE ACTIVE — SGX
          </div>
        </div>
      </aside>
      <main className="main">
        <MarketTicker />
        <header className="topbar">
          <div>
            <span className="crumb">STARKNET / BTCFI / </span>
            <strong>YIELD ROUTER</strong>
          </div>
          <div className="topbar-actions">
            <span className="badge">STARKNET</span>
            <span className="badge green">✓ TEE VERIFIED</span>
            <DepositModal tokens={config.tokens} vaultState={vaultState} />
            <LoginMenu />
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
