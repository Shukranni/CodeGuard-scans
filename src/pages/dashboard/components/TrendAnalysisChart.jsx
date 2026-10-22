/**
 * TrendAnalysisChart — findings over time, split by severity.
 *
 * Colours follow the shared chart palette so the trend chart and the risk
 * donut always agree on what "high" looks like.
 */
import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { CHART_COLORS, AXIS_COLOR, GRID_COLOR } from '../../../utils/chartColors';

const SERIES = [
  { key: 'critical', label: 'Critical', color: CHART_COLORS.critical },
  { key: 'high', label: 'High', color: CHART_COLORS.high },
  { key: 'medium', label: 'Medium', color: CHART_COLORS.medium },
  { key: 'total', label: 'Total', color: CHART_COLORS.total },
];

const TrendAnalysisChart = ({ data }) => {
  const rows = Array.isArray(data) ? data : [];

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-elevation-3">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <ul className="mt-1.5 space-y-0.5">
          {payload.map((entry) => (
            <li key={entry.name} className="flex items-center justify-between gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                {entry.name}
              </span>
              <span className="font-semibold tabular-nums text-foreground">{entry.value}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  if (!rows.length) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border px-6 text-center">
        <p className="text-sm text-muted-foreground">
          No trend data yet — run a scan to start building the history.
        </p>
      </div>
    );
  }

  return (
    <div
      className="h-64 md:h-72"
      role="img"
      aria-label={`Vulnerability trend across ${rows.length} day${rows.length === 1 ? '' : 's'}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={AXIS_COLOR}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            stroke={AXIS_COLOR}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: GRID_COLOR }} />
          <Legend
            wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
            iconType="plainline"
            iconSize={14}
          />
          {SERIES.map((series) => (
            <Line
              key={series.key}
              type="monotone"
              dataKey={series.key}
              stroke={series.color}
              strokeWidth={2}
              dot={{ fill: series.color, r: 3 }}
              activeDot={{ r: 5 }}
              name={series.label}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TrendAnalysisChart;
