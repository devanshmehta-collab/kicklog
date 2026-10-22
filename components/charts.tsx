"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatINR } from "@/lib/money";

const PALETTE = ["#f2f0eb", "#d4b36a", "#5ed68c", "#8e8e96", "#6f8fd6", "#c777b5", "#5e5e66"];
const axis = { stroke: "#8e8e96", fontSize: 11, tickLine: false, axisLine: false } as const;
const tip = {
  contentStyle: { background: "#141416", border: "1px solid #2c2c31", borderRadius: 12, fontSize: 12, color: "#f2f0eb" },
  labelStyle: { color: "#8e8e96" },
  itemStyle: { color: "#f2f0eb" },
};
const rupee = (paise: number) => {
  const r = paise / 100;
  const abs = Math.abs(r);
  const s = abs >= 1e7 ? `${(abs / 1e7).toFixed(1)}Cr` : abs >= 1e5 ? `${(abs / 1e5).toFixed(1)}L` : abs >= 1e3 ? `${(abs / 1e3).toFixed(0)}k` : `${abs}`;
  return `${r < 0 ? "−" : ""}₹${s}`;
};

function Box({ children, h = 240, empty }: { children: React.ReactNode; h?: number; empty?: boolean }) {
  if (empty) return <div className="flex items-center justify-center text-sm text-muted" style={{ height: h }}>No data in this period yet</div>;
  return <div style={{ height: h }} className="w-full">{children}</div>;
}

export function TrendChart({ data }: { data: { bucket: string; revenue: number; profit: number }[] }) {
  return (
    <Box empty={!data.length}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f2f0eb" stopOpacity={0.18} /><stop offset="100%" stopColor="#f2f0eb" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid stroke="#2c2c31" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="bucket" {...axis} />
          <YAxis {...axis} tickFormatter={rupee} width={52} />
          <Tooltip {...tip} formatter={(v) => formatINR(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 12, color: "#8e8e96" }} />
          <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#f2f0eb" strokeWidth={2} fill="url(#rev)" />
          <Area type="monotone" dataKey="profit" name="Profit" stroke="#5ed68c" strokeWidth={2} fill="none" />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function Donut({ data, valueKey = "revenue", money = true }: { data: Record<string, unknown>[]; valueKey?: string; money?: boolean }) {
  return (
    <Box empty={!data.length}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey={valueKey} nameKey="name" innerRadius="58%" outerRadius="85%" paddingAngle={2} stroke="none">
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip {...tip} formatter={(v) => (money ? formatINR(Number(v)) : String(v))} />
          <Legend wrapperStyle={{ fontSize: 12, color: "#8e8e96" }} />
        </PieChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function Bars({ data, x, y, money = true, color = "#f2f0eb", name }: { data: Record<string, unknown>[]; x: string; y: string; money?: boolean; color?: string; name?: string }) {
  return (
    <Box empty={!data.length}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
          <CartesianGrid stroke="#2c2c31" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={x} {...axis} />
          <YAxis {...axis} tickFormatter={money ? rupee : undefined} width={52} />
          <Tooltip {...tip} formatter={(v) => (money ? formatINR(Number(v)) : String(v))} cursor={{ fill: "#ffffff08" }} />
          <Bar dataKey={y} name={name ?? y} fill={color} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
