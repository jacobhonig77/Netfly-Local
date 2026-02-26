import { fmtMoney, fmtPct, pctClass } from "../lib/format";

export default function KpiCard({ label, value, delta, deltaDollar, deltaMode = "pct", isPercent = false, isNumber = false, note = "", deltaLabel = "vs prior", toneClass = "", badge = "", badgeClass = "" }) {
  const showDollar = deltaMode === "$" && deltaDollar != null;
  const deltaClass = showDollar
    ? (deltaDollar >= 0 ? "up" : "down")
    : pctClass(delta);

  let display;
  if (isPercent) display = fmtPct(value);
  else if (isNumber) display = value != null ? Number(value).toLocaleString() : "n/a";
  else display = fmtMoney(value);

  const hasDelta = showDollar || (delta !== null && delta !== undefined);

  return (
    <div className={`kpi-card ${toneClass}`.trim()}>
      {badge ? <span className={`kpi-corner-badge ${badgeClass}`.trim()}>{badge}</span> : null}
      <div className="kpi-title-area">
        <div className="kpi-label">{label}</div>
        {hasDelta && (
          <div className={`kpi-delta ${deltaClass}`}>
            <span className="kpi-delta-arrow">{deltaClass === "up" ? "↗" : deltaClass === "down" ? "↘" : "→"}</span>
            {showDollar
              ? `${deltaDollar >= 0 ? "+" : "-"}${fmtMoney(Math.abs(deltaDollar))}`
              : fmtPct(delta)}
            <span className="kpi-delta-text">{deltaLabel}</span>
          </div>
        )}
      </div>
      <div className="kpi-value">{display}</div>
      {note ? <div className="kpi-note">{note}</div> : null}
    </div>
  );
}
