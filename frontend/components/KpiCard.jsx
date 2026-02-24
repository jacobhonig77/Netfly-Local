import { fmtMoney, fmtPct, pctClass } from "../lib/format";

export default function KpiCard({ label, value, delta, isPercent = false, isNumber = false, note = "", deltaLabel = "vs prior", toneClass = "", badge = "", badgeClass = "" }) {
  const deltaClass = pctClass(delta);
  let display;
  if (isPercent) display = fmtPct(value);
  else if (isNumber) display = value != null ? Number(value).toLocaleString() : "n/a";
  else display = fmtMoney(value);

  return (
    <div className={`kpi-card ${toneClass}`.trim()}>
      {badge ? <span className={`kpi-corner-badge ${badgeClass}`.trim()}>{badge}</span> : null}
      <div className="kpi-title-area">
        <div className="kpi-label">{label}</div>
        {delta !== null && delta !== undefined && (
          <div className={`kpi-delta ${deltaClass}`}>
            <span className="kpi-delta-arrow">{deltaClass === "up" ? "↗" : deltaClass === "down" ? "↘" : "→"}</span>
            {fmtPct(delta)}
            <span className="kpi-delta-text">{deltaLabel}</span>
          </div>
        )}
      </div>
      <div className="kpi-value">{display}</div>
      {note ? <div className="kpi-note">{note}</div> : null}
    </div>
  );
}
