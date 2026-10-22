/**
 * ScanMetadata — the factual details of the scan.
 *
 * Every field is real and rendered conditionally; values the server does not
 * provide (ETA, CPU/memory sampling, …) are simply omitted rather than
 * simulated.
 */
import React from 'react';
import Icon from '../../../components/AppIcon';
import StatusBadge from '../../../components/ui/StatusBadge';

const formatBytes = (bytes) => {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024)?.toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024))?.toFixed(1)} MB`;
};

const MetadataRow = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">{label}</dt>
    <dd className="mt-1 text-sm text-foreground break-words">{children}</dd>
  </div>
);

const ScanMetadata = ({ metadata }) => {
  if (!metadata) {
    return (
      <section className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border px-4 py-4 md:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Icon name="Info" size={17} aria-hidden="true" />
          </span>
          <h2 className="text-base font-semibold text-foreground">Scan metadata</h2>
        </div>
        <div className="px-4 py-4 md:px-5">
          <p className="text-sm text-muted-foreground">Waiting for status…</p>
        </div>
      </section>
    );
  }

  const size = formatBytes(metadata?.totalSize);

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border px-4 py-4 md:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon name="Info" size={17} aria-hidden="true" />
        </span>
        <h2 className="text-base font-semibold text-foreground">Scan metadata</h2>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-4 md:px-5 sm:grid-cols-2">
        <MetadataRow label="Scan ID">
          <span className="font-data text-xs sm:text-sm">{metadata?.scanId}</span>
        </MetadataRow>

        <MetadataRow label="Project">
          {metadata?.projectName}
        </MetadataRow>

        <MetadataRow label="Status">
          <StatusBadge
            status={metadata?.statusLabel?.toLowerCase().replace(/\s+/g, '_')}
            label={metadata?.statusLabel}
            size="xs"
          />
        </MetadataRow>
        {metadata?.stage ? (
          <MetadataRow label="Stage">
            <span className="font-data text-xs sm:text-sm">{metadata.stage}</span>
          </MetadataRow>
        ) : null}

        {metadata?.startTime ? (
          <MetadataRow label="Start time">
            {new Date(metadata.startTime)?.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </MetadataRow>
        ) : null}

        <MetadataRow label="Elapsed time">
          {metadata?.elapsedTime}
        </MetadataRow>

        {metadata?.sourceType ? (
          <MetadataRow label="Source type">
            <span className="inline-flex items-center gap-1.5">
              <Icon
                name={metadata.sourceType === 'github' ? 'Github' : 'FolderArchive'}
                size={15}
                className="text-muted-foreground"
                aria-hidden="true"
              />
              {metadata.sourceType === 'github' ? 'GitHub repository' : 'ZIP archive'}
            </span>
          </MetadataRow>
        ) : null}

        {metadata?.fileCount != null ? (
          <MetadataRow label="Files in archive">
            {metadata.fileCount?.toLocaleString()}
          </MetadataRow>
        ) : null}

        {size ? (
          <MetadataRow label="Project size">{size}</MetadataRow>
        ) : null}

        <MetadataRow label="Background worker">
          <StatusBadge
            status={metadata?.workerOnline ? 'online' : 'offline'}
            size="xs"
          />
        </MetadataRow>

        {metadata?.languages?.length > 0 ? (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Languages detected
            </dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {metadata.languages.map((lang) => (
                <span
                  key={lang}
                  className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-foreground"
                >
                  {lang}
                </span>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
};

export default ScanMetadata;
