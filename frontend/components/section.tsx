export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="section-header">
      <span className="section-title">{title}</span>
      <span className="section-line" />
      {action}
    </div>
  );
}

export function Panel({
  title,
  badge,
  children,
  className = ""
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <h2>{title}</h2>
        {badge ? <span className="panel-badge">{badge}</span> : null}
      </div>
      {children}
    </section>
  );
}
