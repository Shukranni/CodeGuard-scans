/**
 * ScanSummary — step 3 of the new scan wizard.
 *
 * Everything shown here comes from the configuration the user just entered or
 * from the validation response the server returned. No estimated duration or
 * resource figure is invented.
 */
import React from 'react';
import Icon from '../../../components/AppIcon';
import { cn } from '../../../utils/cn';

const SCANNER_NAMES = {
  semgrep: 'Semgrep',
  gitleaks: 'GitLeaks',
  dependency: 'Dependency scanner',
};

const formatSize = (bytes) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
};

const SummaryRow = ({ icon, label, value, mono = false }) => (
  <div className="flex items-start justify-between gap-4 py-2.5">
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      <Icon name={icon} size={15} aria-hidden="true" />
      {label}
    </span>
    <span
      className={cn(
        'text-right text-sm font-medium text-foreground',
        mono && 'font-data text-xs',
      )}
    >
      {value}
    </span>
  </div>
);

const ScanSummary = ({ configuration }) => {
  const validation = configuration?.validationData || {};
  const languages = Array.isArray(validation.languages) ? validation.languages : [];
  const isRepository = configuration?.sourceType === 'github';
  const isExistingProject = configuration?.sourceType === 'existing';
  const sourceLabel = isExistingProject
    ? 'Previously uploaded project'
    : isRepository ? 'GitHub repository' : 'ZIP archive';
  const repositoryLabel = isRepository
    ? (configuration?.repository?.url || validation?.projectName || validation?.name || '—')
    : null;

  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon name="FileSearch" size={19} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-base font-semibold text-foreground">Scan configuration</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Review the configuration before starting the scan.
          </p>
        </div>
      </div>

      <div className="mt-4 divide-y divide-border border-y border-border">
        <SummaryRow icon="Upload" label="Source" value={sourceLabel} />
        {repositoryLabel ? (
          <SummaryRow icon="Github" label="Repository" value={repositoryLabel} mono />
        ) : null}
        <SummaryRow
          icon="FileCode"
          label="Files to scan"
          value={Number(validation.fileCount || 0).toLocaleString()}
        />
        <SummaryRow
          icon="HardDrive"
          label="Archive size"
          value={formatSize(validation.totalSize)}
        />
        <SummaryRow
          icon="Code"
          label="Languages"
          value={languages.length ? languages.join(', ') : 'Not reported'}
        />
      </div>

      <div className="mt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Active scanners
        </h4>
        <ul className="mt-2 flex flex-wrap gap-2">
          {(configuration?.selectedScanners || []).map((scannerId) => (
            <li
              key={scannerId}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
            >
              <Icon name="Check" size={12} aria-hidden="true" />
              {SCANNER_NAMES[scannerId] || scannerId}
            </li>
          ))}
        </ul>
      </div>

      {(configuration?.pathExclusions || configuration?.owaspCategories?.length) ? (
        <div className="mt-5 space-y-3 border-t border-border pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recorded preferences
          </h4>

          {configuration?.pathExclusions ? (
            <div>
              <p className="text-xs text-muted-foreground">Path exclusions</p>
              <p className="mt-1 break-words font-data text-xs text-foreground">
                {configuration.pathExclusions}
              </p>
            </div>
          ) : null}

          {configuration?.owaspCategories?.length ? (
            <div>
              <p className="text-xs text-muted-foreground">OWASP categories</p>
              <p className="mt-1 text-sm text-foreground">
                {configuration.owaspCategories.length} of 10 selected
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3.5">
        <Icon name="Info" size={17} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">Ready to start</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The scan runs in the background. You can follow its progress live or continue with
            other work — the result is stored in your scan history.
          </p>
        </div>
      </div>
    </section>
  );
};

export default ScanSummary;
