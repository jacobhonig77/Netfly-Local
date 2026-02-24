import { fmtPct, pctClass } from "../../lib/format";

export default function DeltaBadge({ value, size = "sm" }) {
  const cls = pctClass(value);
  const arrow = cls === "up" ? "▲" : cls === "down" ? "▼" : "—";
  return (
    <span className={`delta-badge ${cls} ${size}`}>
      {arrow} {fmtPct(value)}
    </span>
  );
}
