import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const AdvancedDetailsPanel = ({ technicalDetails }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
        aria-expanded={isExpanded}
        aria-controls="advanced-details-content"
      >
        <div className="flex items-center gap-3">
          <Icon name="Terminal" size={20} color="var(--color-primary)" />
          <span className="text-base font-semibold text-foreground">Advanced Scanning Details</span>
        </div>
        <Icon
          name={isExpanded ? 'ChevronUp' : 'ChevronDown'}
          size={20}
          color="var(--color-muted-foreground)"
        />
      </button>
      {isExpanded && (
        <div id="advanced-details-content" className="px-6 pb-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                <Icon name="Cpu" size={16} color="var(--color-accent)" />
                System Resources
              </h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">CPU Usage:</span>
                  <span className="font-medium text-foreground">{technicalDetails?.cpuUsage}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Memory Usage:</span>
                  <span className="font-medium text-foreground">{technicalDetails?.memoryUsage} MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Threads Active:</span>
                  <span className="font-medium text-foreground">{technicalDetails?.activeThreads}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                <Icon name="Activity" size={16} color="var(--color-success)" />
                Scan Statistics
              </h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Files Scanned:</span>
                  <span className="font-medium text-foreground">{technicalDetails?.filesScanned}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Lines Analyzed:</span>
                  <span className="font-medium text-foreground">{technicalDetails?.linesAnalyzed?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rules Applied:</span>
                  <span className="font-medium text-foreground">{technicalDetails?.rulesApplied}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Icon name="FileText" size={16} color="var(--color-warning)" />
              Recent Activity Log
            </h4>
            <div className="bg-muted/50 rounded-md p-4 max-h-48 overflow-y-auto">
              <div className="space-y-2 font-mono text-xs">
                {technicalDetails?.activityLog?.map((log, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <span className="text-muted-foreground">[{log?.timestamp}]</span>
                    <span className="text-foreground">{log?.message}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Icon name="Settings" size={16} color="var(--color-primary)" />
              Configuration
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="bg-muted/50 rounded-md p-3">
                <p className="text-muted-foreground mb-1">Scan Mode</p>
                <p className="font-medium text-foreground">{technicalDetails?.scanMode}</p>
              </div>
              <div className="bg-muted/50 rounded-md p-3">
                <p className="text-muted-foreground mb-1">Parallel Jobs</p>
                <p className="font-medium text-foreground">{technicalDetails?.parallelJobs}</p>
              </div>
              <div className="bg-muted/50 rounded-md p-3">
                <p className="text-muted-foreground mb-1">Timeout</p>
                <p className="font-medium text-foreground">{technicalDetails?.timeout}s</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdvancedDetailsPanel;
