/**
 * FilterPanel — narrows the findings list.
 *
 * The severity, scanner and language options are derived from the findings
 * that are actually present in this scan, so a filter can never be empty for
 * a reason the user cannot see. The OWASP list is the standard OWASP Top 10
 * taxonomy with a live count of matching findings.
 */
import React, { useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import { Checkbox } from '../../../components/ui/Checkbox';
import SeverityBadge from '../../../components/ui/SeverityBadge';
import { cn } from '../../../utils/cn';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

const OWASP_CATEGORIES = [
  'A01:2021 - Broken Access Control',
  'A02:2021 - Cryptographic Failures',
  'A03:2021 - Injection',
  'A04:2021 - Insecure Design',
  'A05:2021 - Security Misconfiguration',
  'A06:2021 - Vulnerable Components',
  'A07:2021 - Identification and Authentication Failures',
  'A08:2021 - Software and Data Integrity Failures',
  'A09:2021 - Security Logging and Monitoring Failures',
  'A10:2021 - Server-Side Request Forgery',
];

const FilterPanel = ({ filters, findings = [], onFilterChange, onReset, resultCount }) => {
  const severityOptions = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    findings.forEach((f) => {
      if (counts[f?.severity] !== undefined) counts[f.severity] += 1;
    });
    return SEVERITY_ORDER.filter((severity) => counts[severity] > 0).map((severity) => ({
      value: severity,
      label: `${severity.charAt(0).toUpperCase()}${severity.slice(1)} (${counts[severity]})`,
    }));
  }, [findings]);

  const scannerOptions = useMemo(() => {
    const scanners = Array.from(
      new Set(findings.map((f) => f?.scanner?.toLowerCase()).filter(Boolean)),
    ).sort();
    return [
      { value: 'all', label: 'All scanners' },
      ...scanners.map((scanner) => ({
        value: scanner,
        label: scanner.charAt(0).toUpperCase() + scanner.slice(1),
      })),
    ];
  }, [findings]);

  const languageOptions = useMemo(() => {
    const languages = Array.from(
      new Set(findings.map((f) => f?.language).filter(Boolean)),
    ).sort();
    return [
      { value: 'all', label: 'All languages' },
      ...languages.map((language) => ({ value: language, label: language })),
    ];
  }, [findings]);

  const owaspCounts = useMemo(() => {
    const counts = {};
    OWASP_CATEGORIES.forEach((category) => {
      counts[category] = findings.filter((f) => f?.owasp?.includes(category.split(':')[0])).length;
    });
    return counts;
  }, [findings]);

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon name="Filter" size={15} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-foreground">Filters</h2>
            <p className="text-sm text-muted-foreground">
              Showing {resultCount} {resultCount === 1 ? 'result' : 'results'}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          iconName="RotateCcw"
          iconPosition="left"
        >
          Reset
        </Button>
      </div>

      <div className="space-y-5 px-4 py-4 md:px-5">
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Severity
          </legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onFilterChange('severity', 'all')}
              aria-pressed={filters?.severity === 'all'}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                filters?.severity === 'all'
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              All severities
            </button>
            {severityOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onFilterChange('severity', option.value)}
                aria-pressed={filters?.severity === option.value}
                className={cn(
                  'rounded-full transition-opacity',
                  filters?.severity === option.value ? '' : 'opacity-70 hover:opacity-100',
                )}
              >
                <SeverityBadge severity={option.value} size="sm" label={option.label} />
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Scanner"
            options={scannerOptions}
            value={filters?.scanner}
            onChange={(value) => onFilterChange('scanner', value)}
          />
          <Select
            label="Language"
            options={languageOptions}
            value={filters?.language}
            onChange={(value) => onFilterChange('language', value)}
          />
        </div>

        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            OWASP Top 10 (2021)
          </legend>
          <div className="grid max-h-48 grid-cols-1 gap-1.5 overflow-elegant pr-1 md:grid-cols-2">
            {OWASP_CATEGORIES.map((category) => (
              <Checkbox
                key={category}
                label={category.replace(/ - .*/, '')}
                description={category.split(' - ')[1]}
                size="sm"
                disabled={owaspCounts[category] === 0}
                checked={filters?.owaspCategories?.includes(category)}
                onChange={(e) => {
                  const newCategories = e?.target?.checked
                    ? [...(filters?.owaspCategories || []), category]
                    : (filters?.owaspCategories || [])?.filter((c) => c !== category);
                  onFilterChange('owaspCategories', newCategories);
                }}
              />
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <span className="text-sm text-muted-foreground">
            {resultCount} {resultCount === 1 ? 'finding' : 'findings'} match the current filters
          </span>
          <Checkbox
            label="Show dismissed"
            size="sm"
            checked={filters?.showDismissed}
            onChange={(e) => onFilterChange('showDismissed', e?.target?.checked)}
          />
        </div>
      </div>
    </section>
  );
};

export default FilterPanel;
