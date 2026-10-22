import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const ScanHistoryCard = ({ scan, onViewResults, onRerun, onDownload, onDelete, onSelect, isSelected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'high':
        return 'text-error';
      case 'medium':
        return 'text-warning';
      case 'low':
        return 'text-success';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return 'bg-success/10 text-success';
      case 'failed':
        return 'bg-error/10 text-error';
      case 'in-progress':
        return 'bg-warning/10 text-warning';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date?.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDuration = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  return (
    <div className="vulnerability-card bg-card border border-border rounded-lg p-6 transition-all duration-150 hover:shadow-md">
      <div className="flex items-start gap-4">
        <div className="flex items-center pt-1">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onSelect(scan?.id, e?.target?.checked)}
            className="w-5 h-5 rounded border-border text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2"
            aria-label={`Select scan ${scan?.projectName}`}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-foreground mb-1 truncate">
                {scan?.projectName}
              </h3>
              <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <Icon name="Calendar" size={14} />
                  {formatDate(scan?.scanDate)}
                </span>
                <span className="flex items-center gap-1">
                  <Icon name="Clock" size={14} />
                  {formatDuration(scan?.duration)}
                </span>
                <span className="flex items-center gap-1">
                  <Icon name="FileText" size={14} />
                  {scan?.filesProcessed} files
                </span>
              </div>
            </div>

            <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(scan?.status)}`}>
              {scan?.status}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-error"></div>
              <span className={`text-sm font-medium ${getSeverityColor('high')}`}>
                {scan?.vulnerabilities?.high} High
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-warning"></div>
              <span className={`text-sm font-medium ${getSeverityColor('medium')}`}>
                {scan?.vulnerabilities?.medium} Medium
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success"></div>
              <span className={`text-sm font-medium ${getSeverityColor('low')}`}>
                {scan?.vulnerabilities?.low} Low
              </span>
            </div>
          </div>

          {scan?.trendIndicator && (
            <div className={`flex items-center gap-2 text-sm mb-4 ${scan?.trendIndicator?.type === 'improvement' ? 'text-success' : 'text-error'}`}>
              <Icon name={scan?.trendIndicator?.type === 'improvement' ? 'TrendingDown' : 'TrendingUp'} size={16} />
              <span>{scan?.trendIndicator?.message}</span>
            </div>
          )}

          {isExpanded && (
            <div className="mt-4 pt-4 border-t border-border space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Scanner Versions:</span>
                  <div className="mt-1 space-y-1">
                    {scan?.scannerVersions?.map((scanner, index) => (
                      <div key={index} className="text-foreground">
                        {scanner?.name}: v{scanner?.version}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Project Size:</span>
                  <div className="mt-1 text-foreground">{scan?.projectSize}</div>
                </div>
              </div>

              <div>
                <span className="text-sm text-muted-foreground">Summary Statistics:</span>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div className="flex items-center justify-between p-2 bg-muted rounded">
                    <span className="text-sm">Total Issues</span>
                    <span className="font-semibold">{scan?.totalIssues}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted rounded">
                    <span className="text-sm">Critical Files</span>
                    <span className="font-semibold">{scan?.criticalFiles}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <Button
              variant="default"
              size="sm"
              onClick={() => onViewResults(scan?.id)}
              iconName="Eye"
              iconPosition="left"
            >
              View Results
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onRerun(scan?.id)}
              iconName="RefreshCw"
              iconPosition="left"
            >
              Re-run
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onDownload(scan?.id)}
              iconName="Download"
              iconPosition="left"
            >
              Download
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              iconName={isExpanded ? 'ChevronUp' : 'ChevronDown'}
              iconPosition="right"
            >
              {isExpanded ? 'Less' : 'More'}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(scan?.id)}
              iconName="Trash2"
              iconPosition="left"
              className="text-error hover:text-error ml-auto"
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScanHistoryCard;
