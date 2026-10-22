/**
 * UploadSection — step 1 of the new scan wizard.
 *
 * Two sources are offered:
 *   • a ZIP archive, uploaded to `POST /api/projects/upload/` and then
 *     validated with `GET /api/projects/<id>/validate/`;
 *   • a GitHub repository, fetched by `POST /api/projects/github/`. The
 *     server downloads the repository, archives it and registers it as a
 *     project, so the response already carries the validation data.
 *
 * Upload progress comes from the real request — nothing is simulated.
 */
import React, { useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import { cn } from '../../../utils/cn';
import api from '../../../utils/api';

const MAX_SIZE_BYTES = 100 * 1024 * 1024;

const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const UploadSection = ({
  onFileSelect,
  onRepositorySubmit,
  onValidationComplete,
}) => {
  const [uploadMethod, setUploadMethod] = useState('file');
  const [isDragging, setIsDragging] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [repoBranch, setRepoBranch] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isFetchingRepo, setIsFetchingRepo] = useState(false);
  const [fetchedRepo, setFetchedRepo] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event?.dataTransfer?.files?.[0];
    if (file) handleFileSelection(file);
  };

  const handleFileSelection = async (file) => {
    setError(null);

    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Please choose a ZIP archive. Other file types are not accepted.');
      return;
    }

    if (file.size > MAX_SIZE_BYTES) {
      setError(
        `That archive is ${formatSize(file.size)}. The maximum accepted size is ${formatSize(
          MAX_SIZE_BYTES,
        )}.`,
      );
      return;
    }

    if (isUploading) return; // never upload the same archive twice concurrently

    setSelectedFile(file);
    setUploadProgress(0);
    setIsUploading(true);
    onFileSelect?.(file);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await api.post('/api/projects/upload/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          if (progressEvent?.total) {
            setUploadProgress(
              Math.round((progressEvent.loaded * 100) / progressEvent.total),
            );
          }
        },
      });

      setUploadProgress(100);

      const projectId = response?.data?.id;
      if (!projectId) {
        throw new Error('The server did not return a project id for the uploaded archive.');
      }

      const validationResponse = await api.get(`/api/projects/${projectId}/validate/`);
      onValidationComplete?.({ ...validationResponse?.data, id: projectId });
    } catch (uploadError) {
      setUploadProgress(0);
      setSelectedFile(null);
      setError(
        uploadError?.response?.data?.error ||
          uploadError?.message ||
          'The archive could not be uploaded. Please check your connection and try again.',
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInputChange = (event) => {
    const file = event?.target?.files?.[0];
    if (file) handleFileSelection(file);
    // Allow re-selecting the same file after an error.
    event.target.value = '';
  };

  /**
   * Fetch the repository from the server. The server downloads it, archives
   * it and registers a project — the response already contains the
   * validation data the wizard needs, so no second request is required.
   */
  const handleRepositorySubmit = async () => {
    setError(null);

    if (!repoUrl?.trim()) {
      setError('Enter the URL of the repository you want to scan.');
      return;
    }

    // Never fire a second download while one is in flight.
    if (isFetchingRepo) return;

    setIsFetchingRepo(true);
    setFetchedRepo(null);

    try {
      const response = await api.post('/api/projects/github/', {
        url: repoUrl.trim(),
        token: githubToken?.trim() || undefined,
        branch: repoBranch?.trim() || undefined,
      });

      const projectId = response?.data?.id;
      if (!projectId) {
        throw new Error('The server did not return a project id for the repository.');
      }

      setFetchedRepo(response?.data);

      onRepositorySubmit?.({
        url: repoUrl.trim(),
        token: githubToken?.trim() || '',
        branch: repoBranch?.trim() || '',
        projectId,
      });

      onValidationComplete?.({
        ...response?.data,
        id: projectId,
        projectName: response?.data?.name,
      });
    } catch (fetchError) {
      setError(
        fetchError?.response?.data?.error ||
          fetchError?.message ||
          'The repository could not be fetched. Please check the URL and try again.',
      );
    } finally {
      setIsFetchingRepo(false);
    }
  };

  return (
    <div className="space-y-5">
      <div
        role="group"
        aria-label="Source type"
        className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
      >
        {[
          { id: 'file', label: 'Upload ZIP', icon: 'Upload' },
          { id: 'github', label: 'GitHub repository', icon: 'Github' },
        ].map((method) => {
          const isActive = uploadMethod === method.id;
          return (
            <button
              key={method.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                setUploadMethod(method.id);
                setError(null);
                setFetchedRepo(null);
              }}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                isActive
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon name={method.icon} size={16} aria-hidden="true" />
              {method.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <Alert variant="error" title="Upload problem" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {fetchedRepo ? (
        <Alert variant="success" title="Repository ready" onDismiss={() => setFetchedRepo(null)}>
          {fetchedRepo?.repository?.owner
            ? `${fetchedRepo.repository.owner}/${fetchedRepo.name}`
            : fetchedRepo?.name}{' '}
          was downloaded and is ready for security analysis (
          {Number(fetchedRepo?.fileCount || 0).toLocaleString()} files).
        </Alert>
      ) : null}

      {uploadMethod === 'file' ? (
        <div className="space-y-4">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'rounded-xl border-2 border-dashed p-8 text-center transition-colors md:p-10',
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-border bg-card hover:border-primary/50',
            )}
          >
            <input
              ref={fileInputRef}
              id="project-archive-input"
              type="file"
              accept=".zip,application/zip"
              onChange={handleFileInputChange}
              className="sr-only"
              disabled={isUploading}
            />

            <div className="flex flex-col items-center gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Icon name={isUploading ? 'Loader' : 'Upload'} size={24} aria-hidden="true" className={isUploading ? 'animate-spin' : undefined} />
              </span>

              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {selectedFile ? selectedFile.name : 'Drop your ZIP archive here'}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isUploading
                    ? 'Uploading and validating…'
                    : `or use the file picker · maximum ${formatSize(MAX_SIZE_BYTES)}`}
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                iconName="FolderOpen"
                iconPosition="left"
                onClick={() => fileInputRef.current?.click()}
                loading={isUploading}
                disabled={isUploading}
              >
                Browse files
              </Button>
            </div>
          </div>

          {selectedFile ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Icon name="FileArchive" size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(selectedFile.size)}</p>
                </div>
              </div>
              {isUploading ? (
                <span className="shrink-0 text-xs font-medium tabular-nums text-primary">
                  {uploadProgress}%
                </span>
              ) : uploadProgress === 100 ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-success">
                  <Icon name="CheckCircle2" size={14} aria-hidden="true" />
                  Uploaded
                </span>
              ) : null}
            </div>
          ) : null}

          {isUploading ? (
            <div>
              <div
                className="progress-container"
                role="progressbar"
                aria-valuenow={uploadProgress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Upload progress"
              >
                <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-border bg-card p-4 md:p-5">
          <div className="space-y-1.5">
            <label htmlFor="repo-url" className="block text-sm font-medium text-foreground">
              Repository URL <span className="text-error">*</span>
            </label>
            <div className="relative">
              <Icon
                name="Github"
                size={17}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                id="repo-url"
                type="url"
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
                placeholder="https://github.com/username/repository"
                className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The full URL of a public or private GitHub repository.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="repo-branch" className="block text-sm font-medium text-foreground">
              Branch or tag <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <div className="relative">
              <Icon
                name="GitBranch"
                size={17}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                id="repo-branch"
                type="text"
                value={repoBranch}
                onChange={(event) => setRepoBranch(event.target.value)}
                placeholder="main"
                autoComplete="off"
                className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Leave empty to scan the repository&apos;s default branch.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="repo-token" className="block text-sm font-medium text-foreground">
              GitHub token <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <div className="relative">
              <Icon
                name="Key"
                size={17}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                id="repo-token"
                type="password"
                value={githubToken}
                onChange={(event) => setGithubToken(event.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                autoComplete="off"
                className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Only needed for private repositories. Use a token with the <code className="font-data">repo</code> scope.
              The token is used for the download only — it is never stored.
            </p>
          </div>

          <Button
            fullWidth
            iconName="Download"
            iconPosition="left"
            onClick={handleRepositorySubmit}
            disabled={!repoUrl?.trim() || isFetchingRepo}
            loading={isFetchingRepo}
          >
            {isFetchingRepo ? 'Fetching repository…' : 'Fetch repository'}
          </Button>

          {isFetchingRepo ? (
            <p className="text-xs text-muted-foreground">
              Downloading the repository and preparing it for scanning. Large repositories can take
              a moment.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default UploadSection;
