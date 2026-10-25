/**
 * FindingRow — one vulnerability finding.
 *
 * Collapsed it shows the identity of the finding (severity, location,
 * scanner, OWASP); expanded it shows the description, the vulnerable code and
 * the remediation guidance returned by the scanner.
 */
import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import SeverityBadge from '../../../components/ui/SeverityBadge';
import { cn } from '../../../utils/cn';

const FindingRow = ({ finding, onViewDetails, onDismiss, onOpenInExplorer }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const panelId = `finding-panel-${finding?.id}`;

  return (
    <article
      className={cn(
        'overflow-hidden rounded-xl border bg-card transition-colors duration-150',
        finding?.isDismissed
          ? 'border-border bg-muted/20 opacity-80'
          : 'border-border hover:border-primary/40',
      )}
    >
      <h3>
        <button
          type="button"
          onClick={() => setIsExpanded((open) => !open)}
          aria-expanded={isExpanded}
          aria-controls={panelId}
          className="flex w-full flex-col gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 md:flex-row md:items-start md:gap-4 md:px-5"
        >
          <Icon
            name={isExpanded ? 'ChevronDown' : 'ChevronRight'}
            size={17}
            className="hidden shrink-0 text-muted-foreground md:block"
            aria-hidden="true"
          />

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground md:text-[0.9375rem]">
              {finding?.title}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-1">
                <Icon name="FileCode" size={12} aria-hidden="true" />
                <span className="truncate font-data">{finding?.file}</span>
              </span>
              {finding?.line ? (
                <span className="inline-flex items-center gap-1">
                  <Icon name="Hash" size={12} aria-hidden="true" />
                  Line {finding?.line}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <Icon name="Radar" size={12} aria-hidden="true" />
                {finding?.scanner}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
            <SeverityBadge severity={finding?.severity} size="sm" />
            {finding?.owasp && finding?.owasp !== 'N/A' ? (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {finding?.owasp}
              </span>
            ) : null}
            {finding?.isDismissed ? (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Dismissed
              </span>
            ) : null}
          </div>
        </button>
      </h3>

      {isExpanded ? (
        <div id={panelId} className="border-t border-border px-4 py-4 md:px-5">
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Description
              </h4>
              <p className="mt-1.5 text-sm leading-relaxed text-foreground">{finding?.description}</p>
            </div>

            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">CWE</dt>
                <dd className="mt-0.5 font-data text-xs text-foreground">{finding?.cwe || 'N/A'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">OWASP</dt>
                <dd className="mt-0.5 font-data text-xs text-foreground">{finding?.owasp || 'N/A'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Confidence</dt>
                <dd className="mt-0.5 text-xs text-foreground">{finding?.confidence}%</dd>
              </div>
            </dl>

            {finding?.codeSnippet ? (
              <div className="code-surface">
                <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                  Vulnerable code
                </div>
                <pre className="px-3 py-2.5 text-xs text-foreground">{finding?.codeSnippet}</pre>
              </div>
            ) : null}

            {finding?.fixCode ? (
              <div className="code-surface">
                <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                  Suggested fix
                </div>
                <pre className="px-3 py-2.5 text-xs text-foreground">{finding?.fixCode}</pre>
              </div>
            ) : null}

            {finding?.remediation ? (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Remediation guidance
                </h4>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground">{finding?.remediation}</p>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap">
              <Button
                variant="default"
                size="sm"
                fullWidth
                onClick={() => onViewDetails(finding)}
                iconName="Sparkles"
                iconPosition="left"
              >
                AI explanation
              </Button>
              {finding?.file && onOpenInExplorer ? (
                <Button
                  variant="outline"
                  size="sm"
                  fullWidth
                  onClick={() => onOpenInExplorer(finding)}
                  iconName="FolderTree"
                  iconPosition="left"
                >
                  Open in code explorer
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                fullWidth
                onClick={() => onDismiss(finding?.id)}
                iconName={finding?.isDismissed ? 'RotateCcw' : 'EyeOff'}
                iconPosition="left"
              >
                {finding?.isDismissed ? 'Restore finding' : 'Dismiss finding'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
};

export default FindingRow;
