import React from 'react';
import Icon from '../../../components/AppIcon';
import ModalOverlay from '../../../components/ui/ModalOverlay';

const ComparisonModal = ({ isOpen, onClose, scans }) => {
  if (!scans || scans?.length < 2) return null;

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

  return (
    <ModalOverlay isOpen={isOpen} onClose={onClose} title="Scan Comparison">
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {scans?.map((scan, index) => (
            <div key={scan?.id} className="bg-muted rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-foreground">
                  Scan {index + 1}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {formatDate(scan?.scanDate)}
                </span>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Project Name</p>
                  <p className="text-sm font-medium text-foreground">{scan?.projectName}</p>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-2">Vulnerabilities</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${getSeverityColor('high')}`}>
                        High
                      </span>
                      <span className="text-sm font-bold text-foreground">
                        {scan?.vulnerabilities?.high}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${getSeverityColor('medium')}`}>
                        Medium
                      </span>
                      <span className="text-sm font-bold text-foreground">
                        {scan?.vulnerabilities?.medium}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${getSeverityColor('low')}`}>
                        Low
                      </span>
                      <span className="text-sm font-bold text-foreground">
                        {scan?.vulnerabilities?.low}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-1">Total Issues</p>
                  <p className="text-2xl font-bold text-foreground">{scan?.totalIssues}</p>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-1">Files Processed</p>
                  <p className="text-sm font-medium text-foreground">{scan?.filesProcessed}</p>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-1">Scan Duration</p>
                  <p className="text-sm font-medium text-foreground">{scan?.duration}s</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <h4 className="text-md font-semibold text-foreground mb-3 flex items-center gap-2">
            <Icon name="TrendingUp" size={18} />
            Comparison Summary
          </h4>
          
          <div className="space-y-2">
            {scans?.[0]?.vulnerabilities?.high !== scans?.[1]?.vulnerabilities?.high && (
              <div className="flex items-center justify-between p-2 bg-muted rounded">
                <span className="text-sm text-muted-foreground">High Severity Change</span>
                <span className={`text-sm font-medium ${scans?.[1]?.vulnerabilities?.high > scans?.[0]?.vulnerabilities?.high ? 'text-error' : 'text-success'}`}>
                  {scans?.[1]?.vulnerabilities?.high > scans?.[0]?.vulnerabilities?.high ? '+' : ''}
                  {scans?.[1]?.vulnerabilities?.high - scans?.[0]?.vulnerabilities?.high}
                </span>
              </div>
            )}

            {scans?.[0]?.totalIssues !== scans?.[1]?.totalIssues && (
              <div className="flex items-center justify-between p-2 bg-muted rounded">
                <span className="text-sm text-muted-foreground">Total Issues Change</span>
                <span className={`text-sm font-medium ${scans?.[1]?.totalIssues > scans?.[0]?.totalIssues ? 'text-error' : 'text-success'}`}>
                  {scans?.[1]?.totalIssues > scans?.[0]?.totalIssues ? '+' : ''}
                  {scans?.[1]?.totalIssues - scans?.[0]?.totalIssues}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between p-2 bg-muted rounded">
              <span className="text-sm text-muted-foreground">Time Difference</span>
              <span className="text-sm font-medium text-foreground">
                {Math.abs(scans?.[1]?.duration - scans?.[0]?.duration)}s
              </span>
            </div>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default ComparisonModal;
