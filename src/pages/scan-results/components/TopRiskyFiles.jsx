/**
 * TopRiskyFiles — the files that carry the most risk in this scan.
 *
 * The risk score per file is derived from the severities of its findings
 * (critical 40, high 20, medium 10, low 5, capped at 100).
 */
import React from 'react';
import Icon from '../../../components/AppIcon';
import SeverityBadge from '../../../components/ui/SeverityBadge';

const TopRiskyFiles = ({ files, onSelectFile, selectedFile }) => {
  const list = files || [];

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4 md:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-high/10 text-high">
          <Icon name="Flame" size={15} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-foreground">Top Risky Files</h2>
          <p className="text-sm text-muted-foreground">Ranked by accumulated finding weight</p>
        </div>
      </div>

      <div className="px-4 py-4 md:px-5">
        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No files with findings in this scan.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            {list.map((file, index) => {
              const isSelected = selectedFile && selectedFile === file?.path;
              return (
                <button
                  key={file?.path || index}
                  type="button"
                  onClick={() => onSelectFile?.(isSelected ? null : file?.path)}
                  className={`flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                    isSelected
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border bg-muted/30 hover:bg-muted/50'
                  }`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-card text-xs font-bold tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-data text-xs text-foreground" title={file?.path}>
                      {file?.path}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {file?.vulnerabilities} {file?.vulnerabilities === 1 ? 'finding' : 'findings'} · risk{' '}
                      {file?.riskScore}/100
                    </p>
                  </div>
                  <SeverityBadge severity={file?.highestSeverity} size="xs" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

export default TopRiskyFiles;
