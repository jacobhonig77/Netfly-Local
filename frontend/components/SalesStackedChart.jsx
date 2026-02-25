"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function fmt(v) {
  if (v == null) return "$0";
  return "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum, p) => sum + (p.value || 0), 0);
  return (
    <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
      <p style={{ color: "#9aa6c5", marginBottom: 6 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.fill, margin: "2px 0" }}>
          {p.dataKey.toUpperCase()}: {fmt(p.value)}
        </p>
      ))}
      <p style={{ color: "#fff", borderTop: "1px solid #334155", marginTop: 6, paddingTop: 6, fontWeight: 600 }}>
        Total: {fmt(total)}
      </p>
    </div>
  );
}

export default function SalesStackedChart({ data }) {
  return (
    <div className="panel chart-panel">
      <h3>Sales by Product by Day</h3>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#293146" />
            <XAxis dataKey="date" tick={{ fill: "#9aa6c5", fontSize: 12 }} />
            <YAxis tick={{ fill: "#9aa6c5", fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="iqbar" stackId="a" fill="#5B7CFA" radius={[0, 0, 0, 0]} />
            <Bar dataKey="iqmix" stackId="a" fill="#2CD4BF" radius={[0, 0, 0, 0]} />
            <Bar dataKey="iqjoe" stackId="a" fill="#F59E0B" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
