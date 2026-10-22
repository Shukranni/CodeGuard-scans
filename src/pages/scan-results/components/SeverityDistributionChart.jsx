/**
 * SeverityDistributionChart — how the findings split across severities.
 *
 * The values come straight from the scan payload. The legend and the tooltip
 * always name the severity, so the chart is never read by colour alone.
 */
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import Icon from '../../../components/AppIcon';
import { SEVERITY_SERIES, CHART_COLORS } from '../../../utils/chartColors';

const SeverityDistributionChart = ({ data }) => {
  const chartData = SEVERITY_SERIES
    .map((series) => ({
      name: series.label,
      value: data?.[series.key] || 0,
      color: series.color,
    }))
    .filter((item) => item.value > 0);

  const total = chartData.reduce((sum, item) => sum + item.value, 0);

  return (
    <section className="h-full rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4 md:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon name="ChartPie" size={15} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-foreground">Severity distribution</h2>
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? 'finding' : 'findings'} in total
          </p>
        </div>
      </div>

      <div className="px-4 py-4 md:px-5">
        {chartData.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No findings were reported for this scan.
          </p>
        ) : (
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <div
              className="h-48 w-full sm:h-56 sm:w-1/2"
              role="img"
              aria-label={`Severity distribution: ${chartData
                .map((item) => `${item.name} ${item.value}`)
                .join(', ')}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius="55%"
                    outerRadius="82%"
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${entry.name}-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [`${value} ${value === 1 ? 'finding' : 'findings'}`, name]}
                    contentStyle={{
                      background: CHART_COLORS.info,
                      borderRadius: 10,
                      border: '1px solid rgba(148,163,184,0.35)',
                      color: '#0F172A',
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <ul className="flex w-full flex-col gap-2 sm:w-1/2">
              {SEVERITY_SERIES.map((series) => {
                const value = data?.[series.key] || 0;
                const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                return (
                  <li key={series.key} className="flex items-center gap-2.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: series.color }}
                      aria-hidden="true"
                    />
                    <span className="text-sm text-foreground">{series.label}</span>
                    <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">
                      {value}
                    </span>
                    <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                      {percentage}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
};

export default SeverityDistributionChart;
