import { useId, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

/**
 * Phase 8 - chart primitives shared by every report tab.
 *
 * Recharts reads colours as raw values, so we resolve the Tailwind theme
 * tokens (which live as HSL channels in CSS variables) into concrete HSL
 * strings once per render. Every chart gets the same grid, tooltip and axis
 * styling so the whole Reports screen feels like one surface.
 */

/** Palette used for categorical series (pie slices, multi-line keys). */
export const CHART_COLORS = [
  'hsl(var(--primary))',
  '#3287fc', // brand-500 (there is no --brand CSS var)
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(var(--destructive))',
  '#8b5cf6',
  '#06b6d4',
  '#f97316',
];

const AXIS_TICK = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

const tooltipStyle = {
  contentStyle: {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    fontSize: 12,
    color: 'hsl(var(--popover-foreground))',
    boxShadow: '0 4px 16px rgb(0 0 0 / 0.08)',
  },
  labelStyle: { color: 'hsl(var(--muted-foreground))', fontSize: 11 },
  itemStyle: { color: 'hsl(var(--foreground))' },
};

/** Chart frame: fixed height + a neutral empty state. */
export function ChartFrame({ height = 240, empty, emptyLabel = 'No data in this period', children }) {
  if (empty) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Time-series line/area chart. `data` expects [{ period, value, count? }].
 * `valueKey` lets a caller point at a differently-named field.
 */
export function TrendChart({
  data = [],
  valueKey = 'value',
  secondKey = null,
  height = 240,
  color = 'hsl(var(--primary))',
  secondColor = 'hsl(var(--warning))',
  valueLabel = 'Value',
  secondLabel = '',
  formatValue = (v) => v,
}) {
  const id = useId();
  const rows = useMemo(
    () =>
      (data || []).map((d) => ({
        ...d,
        label: d.period,
        a: Number(d[valueKey] ?? 0),
        b: secondKey ? Number(d[secondKey] ?? 0) : undefined,
      })),
    [data, valueKey, secondKey]
  );

  return (
    <ChartFrame height={height} empty={rows.length === 0}>
      <LineChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={54} />
        <Tooltip
          {...tooltipStyle}
          formatter={(v, name) => [formatValue(v), name]}
        />
        <Line
          type="monotone"
          dataKey="a"
          name={valueLabel}
          stroke={color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          animationDuration={400}
        />
        {secondKey && (
          <Line
            type="monotone"
            dataKey="b"
            name={secondLabel}
            stroke={secondColor}
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={false}
            activeDot={{ r: 4 }}
            animationDuration={400}
          />
        )}
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
      </LineChart>
    </ChartFrame>
  );
}

/** Horizontal bar chart for ranked breakdowns (top customers, reps, …). */
export function BarList({
  data = [],
  labelKey = 'name',
  valueKey = 'value',
  height = 240,
  /** Pass a single colour to make every bar uniform; omit for the palette. */
  color = null,
  formatValue = (v) => v,
}) {
  const rows = useMemo(
    () => (data || []).map((d) => ({ name: d[labelKey] ?? '—', value: Number(d[valueKey] ?? 0) })),
    [data, labelKey, valueKey]
  );

  return (
    <ChartFrame height={height} empty={rows.length === 0}>
      <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={120}
        />
        <Tooltip {...tooltipStyle} formatter={(v) => [formatValue(v), 'Value']} cursor={{ fill: 'hsl(var(--muted))' }} />
        <Bar dataKey="value" fill={color || CHART_COLORS[0]} radius={[0, 4, 4, 0]} animationDuration={400}>
          {!color &&
            rows.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

/** Vertical bar chart (counts/values per discrete category). */
export function ColumnChart({
  data = [],
  nameKey = 'name',
  valueKey = 'value',
  secondKey = null,
  height = 240,
  color = 'hsl(var(--primary))',
  secondColor = 'hsl(var(--warning))',
  valueLabel = 'Value',
  secondLabel = '',
  formatValue = (v) => v,
}) {
  const rows = useMemo(
    () =>
      (data || []).map((d) => ({
        name: d[nameKey] ?? '—',
        a: Number(d[valueKey] ?? 0),
        b: secondKey ? Number(d[secondKey] ?? 0) : undefined,
      })),
    [data, nameKey, valueKey, secondKey]
  );

  return (
    <ChartFrame height={height} empty={rows.length === 0}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={54} />
        <Tooltip {...tooltipStyle} formatter={(v, name) => [formatValue(v), name]} cursor={{ fill: 'hsl(var(--muted))' }} />
        <Bar dataKey="a" name={valueLabel} fill={color} radius={[4, 4, 0, 0]} animationDuration={400} />
        {secondKey && (
          <Bar dataKey="b" name={secondLabel} fill={secondColor} radius={[4, 4, 0, 0]} animationDuration={400} />
        )}
      </BarChart>
    </ChartFrame>
  );
}

/** Donut for share-of-total breakdowns (payment modes, outcomes, categories). */
export function DonutChart({
  data = [],
  nameKey = 'name',
  valueKey = 'value',
  height = 240,
  formatValue = (v) => v,
  centerLabel = '',
  centerValue = '',
}) {
  const rows = useMemo(
    () =>
      (data || [])
        .map((d) => ({ name: d[nameKey] ?? '—', value: Number(d[valueKey] ?? 0) }))
        .filter((d) => d.value > 0),
    [data, nameKey, valueKey]
  );

  return (
    <ChartFrame height={height} empty={rows.length === 0}>
      <div className="relative h-full w-full">
        <PieChart>
          <Pie
            data={rows}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={2}
            animationDuration={400}
          >
            {rows.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} formatter={(v, name) => [formatValue(v), name]} />
          <Legend
            verticalAlign="bottom"
            height={36}
            wrapperStyle={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}
          />
        </PieChart>
        {centerLabel && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold">{centerValue}</span>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{centerLabel}</span>
          </div>
        )}
      </div>
    </ChartFrame>
  );
}

export default { ChartFrame, TrendChart, BarList, ColumnChart, DonutChart, CHART_COLORS };
