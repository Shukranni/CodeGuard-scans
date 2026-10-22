/**
 * RiskDistributionChart — donut of findings per severity.
 *
 * The chart is decorative; the data is also rendered as a labelled list so the
 * information is available to screen readers and does not depend on colour.
 */
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_COLORS } from '../../../utils/chartColors';

const RiskDistributionChart = ({ data }) => {
  const chartData = [
    { name: 'Critical', key: 'critical', value: data?.critical || 0, color: CHART_COLORS.critical },
    { name: 'High', key: 'high', value: data?.high || 0, color: CHART_COLORS.high },
    { name: 'Medium', key: 'medium', value: data?.medium || 0, color: CHART_COLORS.medium },
    { name: 'Low', key: 'low', value: data?.low || 0, color: CHART_COLORS.low },
    { name: 'Info', key: 'info', value: data?.info || 0, color: CHART_COLORS.info },
  ];

  const visible = chartData.filter((item) => item.value > 0);
  const total = chartData.reduce((sum, item) => sum + item.value, 0);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-elevation-3">
        <p className="text-sm font-medium text-foreground">{payload[0].name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {payload[0].value} {payload[0].value === 1 ? 'vulnerability' : 'vulnerabilities'}
        </p>
      </div>
    );
  };

  if (total === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border px-6 text-center">
        <p className="text-sm text-muted-foreground">
          No findings have been recorded for this workspace yet.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="h-56 md:h-64" role="img" aria-label={`Risk distribution: ${chartData
        .filter((item) => item.value > 0)
        .map((item) => `${item.name} ${item.value}`)
        .join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={visible}
              cx="50%"
              cy="50%"
              labelLine={false}
              outerRadius="78%"
              innerRadius="52%"
              stroke="none"
              dataKey="value"
            >
              {visible.map((entry) => (
                <Cell key={entry.key} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {chartData.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.name}
            </span>
            <span className="font-semibold tabular-nums text-foreground">{item.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default RiskDistributionChart;
