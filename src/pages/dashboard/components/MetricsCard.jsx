/**
 * MetricsCard — a single headline number for the dashboard.
 *
 * The API supplies `iconColor` as a CSS custom property; it is mapped to a
 * matching tint so the icon sits on a tinted tile instead of a transparent
 * square (the previous implementation produced an invalid `var(...)15` colour).
 */
import React from 'react';
import Icon from '../../../components/AppIcon';
import { cn } from '../../../utils/cn';

const TILE_TONES = {
  'var(--color-error)': { tile: 'bg-error/10', text: 'text-error' },
  'var(--color-critical)': { tile: 'bg-critical/10', text: 'text-critical' },
  'var(--color-warning)': { tile: 'bg-warning/10', text: 'text-warning' },
  'var(--color-primary)': { tile: 'bg-primary/10', text: 'text-primary' },
  'var(--color-success)': { tile: 'bg-success/10', text: 'text-success' },
  'var(--color-accent)': { tile: 'bg-accent/10', text: 'text-accent' },
};

const DEFAULT_TONE = { tile: 'bg-muted', text: 'text-muted-foreground' };

const CHANGE_TONES = {
  positive: { text: 'text-success', icon: 'TrendingUp' },
  negative: { text: 'text-error', icon: 'TrendingDown' },
  neutral: { text: 'text-muted-foreground', icon: 'Minus' },
};

const MetricsCard = ({ title, value, change, changeType, icon, iconColor, trend }) => {
  const tone = TILE_TONES[iconColor] || DEFAULT_TONE;
  const changeTone = CHANGE_TONES[changeType] || CHANGE_TONES.neutral;

  return (
    <article className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors duration-150 hover:border-primary/30 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', tone.tile, tone.text)}
        >
          <Icon name={icon} size={19} aria-hidden="true" />
        </span>
        {change ? (
          <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', changeTone.text)}>
            <Icon name={changeTone.icon} size={13} aria-hidden="true" />
            {change}
          </span>
        ) : null}
      </div>

      <p className="mt-3.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <p className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
        {value}
      </p>

      {trend ? (
        <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">
          {trend}
        </p>
      ) : null}
    </article>
  );
};

export default MetricsCard;
