import React from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const QuickAccessSection = ({ recentScans, frequentProjects, onViewScan, onStartNewScan }) => {
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now - date) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 48) return 'Yesterday';
    return date?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Icon name="Clock" size={20} />
            Recent Scans
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onStartNewScan()}
            iconName="Plus"
            iconPosition="left"
          >
            New Scan
          </Button>
        </div>

        <div className="space-y-3">
          {recentScans?.map((scan) => (
            <div
              key={scan?.id}
              className="flex items-center justify-between p-3 bg-muted rounded-lg hover:bg-muted/80 transition-colors cursor-pointer"
              onClick={() => onViewScan(scan?.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {scan?.projectName}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-muted-foreground">
                    {formatDate(scan?.scanDate)}
                  </span>
                  <span className="text-xs text-error font-medium">
                    {scan?.vulnerabilities?.high} high
                  </span>
                </div>
              </div>
              <Icon name="ChevronRight" size={20} className="text-muted-foreground flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Icon name="Star" size={20} />
            Frequently Analyzed
          </h3>
        </div>

        <div className="space-y-3">
          {frequentProjects?.map((project) => (
            <div
              key={project?.id}
              className="flex items-center justify-between p-3 bg-muted rounded-lg hover:bg-muted/80 transition-colors cursor-pointer"
              onClick={() => onStartNewScan(project?.name)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {project?.name}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Icon name="Activity" size={12} />
                    {project?.scanCount} scans
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Last: {formatDate(project?.lastScan)}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e?.stopPropagation();
                  onStartNewScan(project?.name);
                }}
                iconName="RefreshCw"
              >
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default QuickAccessSection;
