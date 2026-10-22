import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../AppIcon';
import Button from '../ui/Button';

const QuickActionsPanel = ({ context = 'dashboard' }) => {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);

  const dashboardActions = [
    {
      id: 'new-scan',
      label: 'New Scan',
      icon: 'Plus',
      description: 'Start a new security analysis',
      variant: 'default',
      action: () => navigate('/new-scan-setup')
    },
    {
      id: 'view-results',
      label: 'Recent Results',
      icon: 'FileSearch',
      description: 'View latest scan findings',
      variant: 'outline',
      action: () => navigate('/scan-results')
    },
    {
      id: 'export',
      label: 'Export Report',
      icon: 'Download',
      description: 'Download security report',
      variant: 'outline',
      action: () => console.log('Export report')
    }
  ];

  const resultsActions = [
    {
      id: 'filter',
      label: 'Filter Results',
      icon: 'Filter',
      description: 'Refine vulnerability list',
      variant: 'outline',
      action: () => console.log('Open filters')
    },
    {
      id: 'export-findings',
      label: 'Export Findings',
      icon: 'Download',
      description: 'Download vulnerability report',
      variant: 'outline',
      action: () => console.log('Export findings')
    },
    {
      id: 'new-scan',
      label: 'New Scan',
      icon: 'Plus',
      description: 'Start another analysis',
      variant: 'default',
      action: () => navigate('/new-scan-setup')
    }
  ];

  const actions = context === 'results' ? resultsActions : dashboardActions;

  return (
    <>
      <div className="hidden md:grid md:grid-cols-3 gap-4">
        {actions?.map((action) => (
          <button
            key={action?.id}
            onClick={action?.action}
            className="group p-6 bg-card border border-border rounded-lg hover:border-primary/50 hover:shadow-glow-md transition-smooth text-left"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center group-hover:bg-primary/20 transition-smooth">
                <Icon name={action?.icon} size={24} color="var(--color-primary)" />
              </div>
              <Icon 
                name="ArrowRight" 
                size={20} 
                color="var(--color-muted-foreground)"
                className="opacity-0 group-hover:opacity-100 transition-smooth"
              />
            </div>
            <h3 className="text-base font-heading font-semibold text-foreground mb-1">
              {action?.label}
            </h3>
            <p className="text-sm text-muted-foreground">
              {action?.description}
            </p>
          </button>
        ))}
      </div>
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-[1010] bg-card border-t border-border shadow-glow-xl">
        {isExpanded && (
          <div className="p-4 border-b border-border space-y-2">
            {actions?.map((action) => (
              <button
                key={action?.id}
                onClick={() => {
                  action?.action();
                  setIsExpanded(false);
                }}
                className="w-full flex items-center gap-3 p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-smooth"
              >
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Icon name={action?.icon} size={20} color="var(--color-primary)" />
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-foreground">{action?.label}</div>
                  <div className="text-xs text-muted-foreground">{action?.description}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="p-4 flex items-center gap-3">
          <Button
            variant="default"
            fullWidth
            iconName="Plus"
            iconPosition="left"
            onClick={() => navigate('/new-scan-setup')}
          >
            New Scan
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <Icon name={isExpanded ? 'ChevronDown' : 'ChevronUp'} size={20} />
          </Button>
        </div>
      </div>
    </>
  );
};

export default QuickActionsPanel;
