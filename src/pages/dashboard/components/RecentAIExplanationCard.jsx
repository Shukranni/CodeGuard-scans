/**
 * RecentAIExplanationCard — a finding the workspace recently asked the AI to
 * explain. Opening the card opens the real AI explanation modal for that
 * finding (the API returns the scan and finding ids).
 */
import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import SeverityBadge from '../../../components/ui/SeverityBadge';
import AIExplanationOverlay from '../../../components/navigation/AIExplanationOverlay';

const formatRelativeDate = (dateString) => {
  if (!dateString) return 'Unknown date';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'Unknown date';

  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const RecentAIExplanationCard = ({ explanation }) => {
  const [showOverlay, setShowOverlay] = useState(false);

  return (
    <>
      <article className="rounded-xl border border-border bg-card p-3 transition-colors duration-150 hover:border-accent/40">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Icon name="Sparkles" size={17} aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="min-w-0 truncate text-sm font-semibold text-foreground">
                {explanation?.title || 'Untitled finding'}
              </h4>
              <SeverityBadge severity={explanation?.severity} size="xs" />
            </div>

            {explanation?.description ? (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {explanation.description}
              </p>
            ) : null}

            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Icon name="Clock" size={12} aria-hidden="true" />
                {formatRelativeDate(explanation?.accessedAt)}
              </span>
              {explanation?.cweId ? (
                <span className="font-data">CWE-{explanation.cweId}</span>
              ) : null}
              {explanation?.scanner ? <span>{explanation.scanner}</span> : null}
            </p>
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <Button
            variant="ghost"
            size="xs"
            iconName="Sparkles"
            iconPosition="left"
            onClick={() => setShowOverlay(true)}
            disabled={!explanation?.scan_id || !explanation?.finding_id}
          >
            Open explanation
          </Button>
        </div>
      </article>

      {showOverlay ? (
        <AIExplanationOverlay
          scanId={explanation?.scan_id}
          findingId={explanation?.finding_id}
          finding={explanation}
          onClose={() => setShowOverlay(false)}
        />
      ) : null}
    </>
  );
};

export default RecentAIExplanationCard;
