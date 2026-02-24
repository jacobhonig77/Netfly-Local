export default function ChartTooltip({ active, label, payload }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum, p) => sum + Number(p.value || 0), 0);
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{label}</div>
      {payload.map((entry) => (
        <div className="chart-tooltip-row" key={entry.name}>
          <span className="dot" style={{ background: entry.color }} />
          <span>{entry.name}</span>
          <span className="val">{Number(entry.value || 0).toLocaleString()}</span>
        </div>
      ))}
      <div className="chart-tooltip-total">
        <span>Total</span>
        <span>{total.toLocaleString()}</span>
      </div>
    </div>
  );
}
