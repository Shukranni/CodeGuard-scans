/**
 * ProjectValidation — the result of `GET /api/projects/<id>/validate/`.
 *
 * Shows the languages, file count and archive size the server reported, plus
 * any errors or warnings it returned.
 */
import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Alert from '../../../components/ui/Alert';
import { cn } from '../../../utils/cn';

const formatSize = (bytes) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
};

const ProjectValidation = ({ validationData }) => {
  const [showAllLanguages, setShowAllLanguages] = useState(false);

  if (!validationData) return null;

  const { isValid, languages, fileCount, totalSize, errors, warnings } = validationData;
  const languageList = Array.isArray(languages) ? languages : [];

  const stat = (icon, label, value) => (
    <div className="rounded-lg bg-muted/50 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon name={icon} size={13} aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );

  return (
    <section
      aria-label="Project validation"
      className={cn(
        'rounded-xl border bg-card p-4 md:p-5',
        isValid ? 'border-success/30' : 'border-error/30',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            isValid ? 'bg-success/10 text-success' : 'bg-error/10 text-error',
          )}
        >
          <Icon name={isValid ? 'CheckCircle2' : 'AlertCircle'} size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">
            {isValid ? 'Project validated' : 'Validation failed'}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isValid
              ? 'The archive was accepted and is ready for security analysis.'
              : 'The server could not accept this archive. Review the details below.'}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {stat('Code', 'Languages', languageList.length)}
        {stat('FileCode', 'Files', Number(fileCount || 0).toLocaleString())}
        {stat('HardDrive', 'Size', formatSize(totalSize))}
      </div>

      {languageList.length ? (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Detected languages
          </p>
          <ul className="mt-2 flex flex-wrap items-center gap-1.5">
            {(showAllLanguages ? languageList : languageList.slice(0, 5)).map((language) => (
              <li
                key={language}
                className="rounded-full bg-muted px-2.5 py-0.5 font-data text-xs text-foreground"
              >
                {language}
              </li>
            ))}
            {languageList.length > 5 ? (
              <li>
                <button
                  type="button"
                  onClick={() => setShowAllLanguages((prev) => !prev)}
                  className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                >
                  {showAllLanguages
                    ? 'Show less'
                    : `+${languageList.length - 5} more`}
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {errors?.length ? (
        <div className="mt-4 space-y-2">
          {errors.map((error, index) => (
            <Alert key={`error-${index}`} variant="error" title={error?.title || 'Error'}>
              {error?.message}
            </Alert>
          ))}
        </div>
      ) : null}

      {warnings?.length ? (
        <div className="mt-2 space-y-2">
          {warnings.map((warning, index) => (
            <Alert key={`warning-${index}`} variant="warning" title={warning?.title || 'Warning'}>
              {warning?.message}
            </Alert>
          ))}
        </div>
      ) : null}
    </section>
  );
};

export default ProjectValidation;
