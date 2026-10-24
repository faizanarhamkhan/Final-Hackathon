'use client';

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Empty } from './ui';

export const PALETTE = ['#0f9d7a', '#5b4fcf', '#e8912d', '#2f6fd6', '#d64545', '#14b8a6', '#a855f7', '#64748b'];

const axis = { fontSize: 11.5, fill: 'var(--muted)' };
const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 12.5 };

export function BarsChart({ data, x, bars, height = 240, layout = 'horizontal', empty = 'No data for these filters' }) {
  if (!data?.length || data.every((d) => bars.every((b) => !d[b.key]))) return <Empty title={empty} />;
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 12, left: vertical ? 10 : -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={vertical} horizontal={!vertical} />
        {vertical ? (
          <>
            <XAxis type="number" tick={axis} allowDecimals={false} />
            <YAxis type="category" dataKey={x} tick={axis} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} tick={axis} interval={0} />
            <YAxis tick={axis} allowDecimals={false} />
          </>
        )}
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--surface-2)' }} />
        {bars.length > 1 && <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />}
        {bars.map((b, i) => (
          <Bar key={b.key} dataKey={b.key} name={b.label} fill={b.color || PALETTE[i]} radius={vertical ? [0, 5, 5, 0] : [5, 5, 0, 0]} maxBarSize={38} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LinesChart({ data, x, lines, height = 240, yDomain, empty = 'No data for these filters' }) {
  if (!data?.length) return <Empty title={empty} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={x} tick={axis} />
        <YAxis tick={axis} domain={yDomain} />
        <Tooltip contentStyle={tooltipStyle} />
        {lines.map((l, i) => (
          <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={l.color || PALETTE[i]} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, nameKey, valueKey, height = 220, empty = 'No data' }) {
  const rows = (data || []).filter((d) => d[valueKey] > 0);
  if (!rows.length) return <Empty title={empty} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={rows} dataKey={valueKey} nameKey={nameKey} innerRadius="55%" outerRadius="85%" paddingAngle={2}>
          {rows.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
