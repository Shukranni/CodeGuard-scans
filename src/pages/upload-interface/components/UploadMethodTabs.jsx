import React from 'react';
import Icon from '../../../components/AppIcon';

const UploadMethodTabs = ({ activeTab, onTabChange }) => {
  const tabs = [
    {
      id: 'zip',
      label: 'ZIP Upload',
      icon: 'FileArchive',
      description: 'Upload your project as a ZIP file'
    },
    {
      id: 'github',
      label: 'GitHub Repository',
      icon: 'Github',
      description: 'Connect your GitHub repository'
    }
  ];

  return (
    <div className="w-full">
      <div className="flex gap-2 p-1 bg-muted rounded-lg">
        {tabs?.map((tab) => (
          <button
            key={tab?.id}
            onClick={() => onTabChange(tab?.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-medium transition-all duration-200 ${
              activeTab === tab?.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
            }`}
            aria-label={tab?.description}
            aria-pressed={activeTab === tab?.id}
          >
            <Icon
              name={tab?.icon}
              size={18}
              color={activeTab === tab?.id ? 'var(--color-foreground)' : 'var(--color-muted-foreground)'}
            />
            <span className="hidden sm:inline">{tab?.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default UploadMethodTabs;
