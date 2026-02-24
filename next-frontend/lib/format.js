export function fmtMoney(value) {
  const n = Number(value || 0);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

export function fmtPct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

export function pctClass(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "neutral";
  return Number(value) >= 0 ? "up" : "down";
}

export function ymd(d) {
  return d.toISOString().slice(0, 10);
}
