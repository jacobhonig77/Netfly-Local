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
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10 }} />
            <Bar dataKey="iqbar" stackId="a" fill="#5B7CFA" radius={[0, 0, 0, 0]} />
            <Bar dataKey="iqmix" stackId="a" fill="#2CD4BF" radius={[0, 0, 0, 0]} />
            <Bar dataKey="iqjoe" stackId="a" fill="#F59E0B" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
