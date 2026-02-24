export default function StatusBadge({ label = "Neutral", tone = "neutral" }) {
  return <span className={`status-badge ${tone}`}>{label}</span>;
}
