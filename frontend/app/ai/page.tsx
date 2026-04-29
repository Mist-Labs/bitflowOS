import { Panel, SectionHeader } from "@/components/section";

const checks = [
  ["0G attestation", "verified per recommendation"],
  ["Attestation hash", "returned before deployment"],
  ["Max LP exposure", "pass"],
  ["Idle reserve", "pass"],
  ["Strategy caps", "pass"],
  ["Vault state", "live Starknet RPC"],
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
              Build each allocation from live vault state, Kimi policy weights, configured route caps, and 0G verification before the
              router executor submits an on-chain rebalance.
            </p>
            <div className="risk-tags">
              <span>0G VERIFIED</span>
              <span>LP CAP ENFORCED</span>
              <span>HUMAN CONFIRMATION</span>
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
