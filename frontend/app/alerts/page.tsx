import { Panel, SectionHeader } from "@/components/section";
import { alertEvents } from "@/lib/data";

export default function AlertsPage() {
  return (
    <>
      <SectionHeader title="Farcaster Alerts" />
      <section className="two-col">
        <Panel title="Notification Events" badge="FARCASTER">
          <div className="event-grid">
            {alertEvents.map(event => (
              <label className="toggle-row" key={event}>
                <input defaultChecked type="checkbox" />
                <span>{event.replaceAll("_", " ")}</span>
              </label>
            ))}
          </div>
        </Panel>
        <Panel title="Delivery Setup" badge="NEYNAR READY">
          <div className="panel-body prose-panel">
            <p>Users enable Mini App notifications. The backend stores the Farcaster notification token and sends alerts for bridge, staking, harvest, unstaking, withdrawals, and risk warnings.</p>
            <div className="callout">Next setup: finalize `farcaster.json`, host the app, and add account association fields.</div>
          </div>
        </Panel>
      </section>
    </>
  );
}
