import { DepositFlow } from "@/components/deposit-flow";
import { Panel, SectionHeader } from "@/components/section";
import { WalletOnboarding } from "@/components/wallet-onboarding";
import { getAppConfig, getVaultState, getWalletOptions } from "@/lib/api";

export default async function DepositPage() {
  const [config, wallets, vaultState] = await Promise.all([
    getAppConfig(),
    getWalletOptions(),
    getVaultState()
  ]);

  return (
    <>
      <SectionHeader title="Deposit And Bridge" />
      <section className="two-col">
        <Panel title="BTC Intake" badge="ATOMIQ + STARKZAP">
          <div className="panel-body">
            <DepositFlow tokens={config.tokens} vaultState={vaultState} />
          </div>
        </Panel>
        <Panel title="Wallet Mode" badge="USER SIGNS">
          <div className="panel-body">
            <WalletOnboarding options={wallets} />
            <div className="callout">
              Native BTC lands in the user wallet first. BitflowOS only prepares Starknet calls; the user signs the vault deposit.
            </div>
          </div>
        </Panel>
      </section>
    </>
  );
}
