import { Panel, SectionHeader } from "@/components/section";
import { getAppConfig, getStarkZapConfig, getVaultState } from "@/lib/api";

export default async function SettingsPage() {
  const [appConfig, starkzap, vaultState] = await Promise.all([
    getAppConfig(),
    getStarkZapConfig(),
    getVaultState()
  ]);

  return (
    <>
      <SectionHeader title="Runtime Settings" />
      <section className="settings-grid">
        <Panel title="Deployment" badge={appConfig.starknetNetwork.toUpperCase()}>
          <div className="config-table">
            <span>Vault</span>
            <strong>{appConfig.vaultAddress || "not deployed"}</strong>
            <span>Router</span>
            <strong>{appConfig.contracts?.router || "not deployed"}</strong>
            <span>Registry</span>
            <strong>{appConfig.contracts?.attestationRegistry || "not deployed"}</strong>
            <span>BTC Network</span>
            <strong>{appConfig.bitcoinNetwork}</strong>
            <span>Bridge</span>
            <strong>{appConfig.nativeBtcBridge.provider}</strong>
          </div>
        </Panel>
        <Panel title="Sepolia Route State" badge="LIVE READS">
          <div className="config-table">
            <span>Assets</span>
            <strong>{vaultState.assets.length}</strong>
            <span>Strategies</span>
            <strong>{vaultState.strategies.length}</strong>
            <span>RPC</span>
            <strong>{vaultState.rpcUrl ? "configured" : "missing"}</strong>
          </div>
        </Panel>
        <Panel title="StarkZap Surface" badge={starkzap.package.toUpperCase()}>
          <div className="config-table">
            <span>Wallet Modes</span>
            <strong>{starkzap.walletEntryPoints.length || 3}</strong>
            <span>Network</span>
            <strong>{starkzap.network}</strong>
            <span>Paymasters</span>
            <strong>{Object.keys(starkzap.paymasters).join(" / ") || "configure"}</strong>
          </div>
        </Panel>
      </section>
    </>
  );
}
