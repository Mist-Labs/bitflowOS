import { Panel, SectionHeader } from "@/components/section";

const checks = [
  ["Attestation hash", "pending deployed registry"],
  ["Max LP exposure", "pass"],
  ["Idle reserve", "pass"],
  ["Strategy caps", "pass"],
  ["Stale data guard", "needs live indexer"],
  ["Confidence threshold", "pass"]
];

export default function AiPolicyPage() {
  return (
    <>
      <SectionHeader title="AI Recommendation And Policy" />
      <section className="two-col wide-left">
        <Panel title="Latest Recommendation" badge="TEE READY">
          <div className="ai-panel">
            <div className="confidence">
              <span>87%</span>
              <small>MODEL CONFIDENCE</small>
            </div>
            <p>
              Maintain conservative Vesu/Endur exposure, route only bounded capital into Ekubo, and keep idle reserve until live
              withdrawal behavior is confirmed.
            </p>
            <div className="risk-tags">
              <span>LOW UTILIZATION RISK</span>
              <span>LP CAP ENFORCED</span>
              <span>LIVE TEST REQUIRED</span>
            </div>
          </div>
        </Panel>
        <Panel title="Deterministic Checks" badge="POLICY">
          <div className="check-list">
            {checks.map(([name, status]) => (
              <div className="check-row" key={name}>
                <span>{name}</span>
                <strong>{status}</strong>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </>
  );
}
