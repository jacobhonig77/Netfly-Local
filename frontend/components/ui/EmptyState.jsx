export default function EmptyState({ title = "No data for this period", subtitle = "Try adjusting your date range or check your imports", cta = null }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">◌</div>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-subtitle">{subtitle}</div>
      {cta ? <div className="empty-state-cta">{cta}</div> : null}
    </div>
  );
}
