import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import api from '../../../utils/api';

const GITHUB_URL_PATTERN = /^https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+\/?$/;

/**
 * Connects a GitHub repository to the scanner.
 *
 * The repository is downloaded by the server (`POST /api/projects/github/`),
 * which archives it and registers it as a project. The parent receives the
 * created project, not the raw URL.
 */
const GitHubRepoInput = ({ onRepoSubmit }) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isFetching, setIsFetching] = useState(false);

  const isValidUrl = GITHUB_URL_PATTERN.test(repoUrl.trim());

  const handleInputChange = (e) => {
    setRepoUrl(e?.target?.value);
    setErrorMessage('');
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!isValidUrl || isFetching) return;

    setIsFetching(true);
    setErrorMessage('');

    try {
      const response = await api.post('/api/projects/github/', { url: repoUrl.trim() });

      const project = response?.data;
      if (!project?.id) {
        throw new Error('The server did not return a project id for the repository.');
      }

      onRepoSubmit?.(project);
    } catch (error) {
      setErrorMessage(
        error?.response?.data?.error ||
          error?.message ||
          'The repository could not be fetched. Please check the URL and try again.',
      );
    } finally {
      setIsFetching(false);
    }
  };

  const handleClear = () => {
    setRepoUrl('');
    setErrorMessage('');
  };

  const getInputIcon = () => {
    if (isFetching) {
      return <Icon name="Loader2" size={20} className="animate-spin text-muted-foreground" />;
    }
    if (errorMessage) {
      return <Icon name="AlertCircle" size={20} color="var(--color-error)" />;
    }
    if (isValidUrl) {
      return <Icon name="CheckCircle" size={20} color="var(--color-success)" />;
    }
    return <Icon name="Github" size={20} className="text-muted-foreground" />;
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <Input
            type="url"
            label="GitHub Repository URL"
            placeholder="https://github.com/username/repository"
            value={repoUrl}
            onChange={handleInputChange}
            error={errorMessage}
            description="Enter the full URL of your GitHub repository"
            disabled={isFetching}
          />
          <div className="absolute right-3 top-9">
            {getInputIcon()}
          </div>
        </div>

        {errorMessage ? (
          <Alert variant="error" title="Repository problem" onDismiss={() => setErrorMessage('')}>
            {errorMessage}
          </Alert>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            variant="default"
            disabled={!isValidUrl || isFetching}
            iconName="GitBranch"
            iconPosition="left"
            loading={isFetching}
          >
            {isFetching ? 'Connecting…' : 'Connect Repository'}
          </Button>

          {repoUrl && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleClear}
              iconName="X"
              iconPosition="left"
              disabled={isFetching}
            >
              Clear
            </Button>
          )}
        </div>
      </form>

      <div className="mt-6 p-4 bg-muted/50 rounded-lg border border-border">
        <div className="flex items-start gap-3">
          <Icon name="Info" size={20} className="text-primary flex-shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Repository Access</p>
            <p>Make sure your repository is public or you have provided the necessary access tokens for private repositories.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GitHubRepoInput;
