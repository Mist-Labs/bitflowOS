import { AgentTerminal } from "@/components/agent-terminal";
import { DashboardLive, LiveAllocation } from "@/components/dashboard-live";
import { Panel, SectionHeader } from "@/components/section";
import { getAppConfig } from "@/lib/api";
import { ShieldCheck } from "lucide-react";

export default async function DashboardPage() {
  const config = await getAppConfig();

  return (
    <>
      <SectionHeader title="Vault Overview" />
      <DashboardLive config={config} />

      <section className="main-grid">
        <Panel title="Current Allocation" badge="LIVE SHAPED">
          <LiveAllocation />
        </Panel>

        <aside className="right-stack">
          <Panel title="Next Action" badge="READY">
            <div className="action-panel">
              <ShieldCheck size={28} />
              <p>Vault route ready.</p>
              <AgentTerminal />
            </div>
          </Panel>
        </aside>
      </section>
    </>
  );
}
