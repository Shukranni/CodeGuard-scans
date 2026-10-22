/**
 * SeverityBadge — the single, app-wide representation of a finding severity.
 *
 * Design contract
 *   • The severity name is always rendered (never colour alone).
 *   • Every severity carries a distinct glyph, so the badge is readable
 *     without colour perception.
 *   • The colour scale matches the one used by charts, risk scores and the
 *     `severity-critical | high | medium | low` utility classes:
 *        critical → red     high → amber
 *        medium   → blue    low  → emerald
 */
import React from 'react';
import Icon from '../AppIcon';
import { cn } from '../../utils/cn';

export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

const SEVERITY_CONFIG = {
  critical: {
    label: 'Critical',
    icon: 'OctagonAlert',
    badge: 'bg-critical/10 text-critical border-critical/25',
    dot: 'bg-critical',
    text: 'text-critical',
    surface: 'bg-critical/10 border-critical/25',
  },
  high: {
    label: 'High',
    icon: 'AlertTriangle',
    badge: 'bg-high/10 text-high border-high/25',
    dot: 'bg-high',
    text: 'text-high',
    surface: 'bg-high/10 border-high/25',
  },
  medium: {
    label: 'Medium',
    icon: 'AlertCircle',
    badge: 'bg-medium/10 text-medium border-medium/25',
    dot: 'bg-medium',
    text: 'text-medium',
    surface: 'bg-medium/10 border-medium/25',
  },
  low: {
    label: 'Low',
    icon: 'Info',
    badge: 'bg-low/10 text-low border-low/25',
    dot: 'bg-low',
    text: 'text-low',
    surface: 'bg-low/10 border-low/25',
  },
  info: {
    label: 'Info',
    icon: 'Info',
    badge: 'bg-info/10 text-info border-info/25',
    dot: 'bg-info',
    text: 'text-info',
    surface: 'bg-info/10 border-info/25',
  },
};

const FALLBACK = SEVERITY_CONFIG.medium;

export const getSeverityConfig = (severity) =>
  SEVERITY_CONFIG[String(severity || '').toLowerCase()] || FALLBACK;

const SIZE_CLASSES = {
  xs: 'px-1.5 py-0.5 text-[11px] gap-1',
  sm: 'px-2 py-0.5 text-xs gap-1',
  default: 'px-2.5 py-0.5 text-xs gap-1.5',
  lg: 'px-3 py-1 text-sm gap-1.5',
};

const ICON_SIZE = {
  xs: 10,
  sm: 12,
  default: 12,
  lg: 16,
};

/**
 * @param {object} props
 * @param {string} props.severity  critical | high | medium | low | info
 * @param {'xs'|'sm'|'default'|'lg'} [props.size]
 * @param {boolean} [props.showIcon]
 * @param {string} [props.label]    overrides the default severity label
 * @param {string} [props.className]
 */
const SeverityBadge = ({
  severity,
  size = 'default',
  showIcon = true,
  label,
  className,
}) => {
  const config = getSeverityConfig(severity);
  const text = label || config.label;

  return (
    <span
      className={cn('severity-badge border', config.badge, SIZE_CLASSES[size], className)}
      title={`${text} severity`}
    >
      {showIcon && <Icon name={config.icon} size={ICON_SIZE[size]} aria-hidden="true" />}
      <span className="uppercase tracking-wide">{text}</span>
    </span>
  );
};

/**
 * SeverityDot — a compact severity indicator for dense lists.
 * The severity name is exposed to assistive technology via `sr-only`.
 */
export const SeverityDot = ({ severity, className }) => {
  const config = getSeverityConfig(severity);
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('h-2 w-2 rounded-full', config.dot)} aria-hidden="true" />
      <span className="sr-only">{config.label} severity</span>
    </span>
  );
};

export default SeverityBadge;
