import React from 'react';
import Icon from '../../../components/AppIcon';

const ProjectDetailsCard = ({ projectDetails }) => {
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes?.[i];
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date?.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
        <Icon name="FolderOpen" size={20} color="var(--color-primary)" />
        Project Details
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon name="FileCode2" size={20} color="var(--color-primary)" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Project Name</p>
            <p className="text-base font-medium text-foreground">{projectDetails?.name}</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
            <Icon name="Files" size={20} color="var(--color-accent)" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Files</p>
            <p className="text-base font-medium text-foreground">{projectDetails?.fileCount?.toLocaleString()}</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center flex-shrink-0">
            <Icon name="HardDrive" size={20} color="var(--color-success)" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Repository Size</p>
            <p className="text-base font-medium text-foreground">{formatFileSize(projectDetails?.size)}</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center flex-shrink-0">
            <Icon name="Clock" size={20} color="var(--color-warning)" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Scan Started</p>
            <p className="text-base font-medium text-foreground">{formatTimestamp(projectDetails?.startTime)}</p>
          </div>
        </div>
      </div>
      {projectDetails?.source && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center gap-2">
            <Icon name={projectDetails?.source === 'github' ? 'Github' : 'Upload'} size={16} color="var(--color-muted-foreground)" />
            <span className="text-sm text-muted-foreground">
              Source: {projectDetails?.source === 'github' ? 'GitHub Repository' : 'ZIP Upload'}
            </span>
          </div>
          {projectDetails?.sourceUrl && (
            <p className="text-sm font-mono text-foreground mt-1 truncate">{projectDetails?.sourceUrl}</p>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectDetailsCard;
