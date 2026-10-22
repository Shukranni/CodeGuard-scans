/**
 * Chart palette.
 *
 * Recharts needs literal colour values, so the semantic tokens cannot be used
 * directly. These constants mirror the CSS severity palette closely enough to
 * read as "the same colour" in a chart context, and they keep every chart in
 * the app consistent.
 *
 * Severity is never communicated by colour alone in charts either — legends
 * and tooltips always carry the severity name.
 */
export const CHART_COLORS = {
  critical: '#EF4444',
  high: '#F59E0B',
  medium: '#3B82F6',
  low: '#10B981',
  info: '#94A3B8',
  total: '#2563EB',
  primary: '#0F766E',
};

export const SEVERITY_SERIES = [
  { key: 'critical', label: 'Critical', color: CHART_COLORS.critical },
  { key: 'high', label: 'High', color: CHART_COLORS.high },
  { key: 'medium', label: 'Medium', color: CHART_COLORS.medium },
  { key: 'low', label: 'Low', color: CHART_COLORS.low },
];

export const AXIS_COLOR = '#94A3B8';
export const GRID_COLOR = 'rgba(148, 163, 184, 0.18)';
