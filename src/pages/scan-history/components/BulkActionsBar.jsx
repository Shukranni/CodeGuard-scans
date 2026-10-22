import React from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const BulkActionsBar = ({ selectedCount, onCompare, onExport, onDelete, onClearSelection }) => {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 animate-scale-in">
      <div className="bg-card border border-border rounded-lg shadow-2xl p-4 flex items-center gap-4">
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-md">
          <Icon name="CheckSquare" size={20} className="text-primary" />
          <span className="text-sm font-medium text-foreground">
            {selectedCount} selected
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCompare}
            iconName="GitCompare"
            iconPosition="left"
            disabled={selectedCount < 2}
          >
            Compare
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            iconName="Download"
            iconPosition="left"
          >
            Export
          </Button>

          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            iconName="Trash2"
            iconPosition="left"
          >
            Delete
          </Button>

          <div className="w-px h-6 bg-border mx-2"></div>

          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            iconName="X"
          >
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BulkActionsBar;
