import React from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const RecentScansSection = ({ onScanSelect }) => {
  const recentScans = [
    {
      id: 1,
      name: "e-commerce-platform",
      type: "zip",
      scanDate: new Date("2025-12-09T14:30:00"),
      vulnerabilities: { high: 3, medium: 7, low: 12 },
      status: "completed"
    },
    {
      id: 2,
      name: "authentication-service",
      type: "github",
      repoUrl: "https://github.com/company/auth-service",
      scanDate: new Date("2025-12-08T10:15:00"),
      vulnerabilities: { high: 1, medium: 4, low: 8 },
      status: "completed"
    },
    {
      id: 3,
      name: "payment-gateway-integration",
      type: "zip",
      scanDate: new Date("2025-12-07T16:45:00"),
      vulnerabilities: { high: 5, medium: 9, low: 15 },
      status: "completed"
    }
  ];

  const formatDate = (date) => {
    const now = new Date();
    const diffInHours = Math.floor((now - date) / (1000 * 60 * 60));
    
    if (diffInHours < 24) {
      return `${diffInHours} hours ago`;
    } else if (diffInHours < 48) {
      return 'Yesterday';
    } else {
      return date?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
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

  const getTotalVulnerabilities = (vulnerabilities) => {
    return vulnerabilities?.high + vulnerabilities?.medium + vulnerabilities?.low;
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Recent Scans</h3>
        <Button
          variant="ghost"
          size="sm"
          iconName="History"
          iconPosition="left"
          onClick={() => window.location.href = '/scan-history'}
        >
          View All
        </Button>
      </div>
      <div className="space-y-3">
        {recentScans?.map((scan) => (
          <div
            key={scan?.id}
            className="bg-card rounded-lg border border-border p-4 hover:shadow-md transition-all duration-200 cursor-pointer group"
            onClick={() => onScanSelect(scan)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Icon
                    name={scan?.type === 'github' ? 'Github' : 'FileArchive'}
                    size={20}
                    color="var(--color-primary)"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {scan?.name}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDate(scan?.scanDate)}
                  </p>

                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center gap-1">
                      <Icon name="AlertCircle" size={14} className={getSeverityColor('high')} />
                      <span className="text-xs font-medium text-error">{scan?.vulnerabilities?.high}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Icon name="AlertTriangle" size={14} className={getSeverityColor('medium')} />
                      <span className="text-xs font-medium text-warning">{scan?.vulnerabilities?.medium}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Icon name="Info" size={14} className={getSeverityColor('low')} />
                      <span className="text-xs font-medium text-success">{scan?.vulnerabilities?.low}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-shrink-0 flex flex-col items-end gap-2">
                <div className="px-2 py-1 rounded-md bg-success/10 text-success text-xs font-medium">
                  {getTotalVulnerabilities(scan?.vulnerabilities)} issues
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  iconName="RotateCw"
                  iconPosition="left"
                  onClick={(e) => {
                    e?.stopPropagation();
                    onScanSelect(scan);
                  }}
                >
                  Re-scan
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {recentScans?.length === 0 && (
        <div className="text-center py-12 bg-muted/30 rounded-lg border border-dashed border-border">
          <Icon name="Clock" size={48} className="text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No recent scans found</p>
          <p className="text-xs text-muted-foreground mt-1">Upload a project to get started</p>
        </div>
      )}
    </div>
  );
};

export default RecentScansSection;
