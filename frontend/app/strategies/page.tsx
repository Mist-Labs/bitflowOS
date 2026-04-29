import { Panel, SectionHeader } from "@/components/section";
import { strategies } from "@/lib/data";

export default function StrategiesPage() {
  return (
    <>
      <SectionHeader title="Strategy Registry" />
      <section className="strategy-grid">
        {strategies.map(strategy => (
          <Panel title={strategy.name} badge={strategy.status.toUpperCase()} key={strategy.id}>
            <div className="strategy-card-body">
              <div className="strategy-meta">
                <span>{strategy.protocol}</span>
                <span>{strategy.asset}</span>
              </div>
              <p>{strategy.description}</p>
              <div className="strategy-stats">
                <span>
                  Allocation
                  <strong>{strategy.allocation}%</strong>
                </span>
                <span>
                  APY
                  <strong>{strategy.apy}</strong>
                </span>
                <span>
                  Risk
                  <strong>{strategy.risk}</strong>
                </span>
              </div>
            </div>
          </Panel>
        ))}
      </section>
    </>
  );
}
