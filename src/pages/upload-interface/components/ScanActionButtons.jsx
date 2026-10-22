import React from 'react';
import Button from '../../../components/ui/Button';

const ScanActionButtons = ({ 
  canStartScan, 
  isScanning, 
  onStartScan, 
  onClearAll,
  onViewHistory 
}) => {
  return (
    <div className="w-full flex flex-col sm:flex-row items-center gap-3">
      <Button
        variant="default"
        size="lg"
        fullWidth
        onClick={onStartScan}
        disabled={!canStartScan || isScanning}
        loading={isScanning}
        iconName="Play"
        iconPosition="left"
        className="sm:flex-1"
      >
        {isScanning ? 'Starting Scan...' : 'Start Security Scan'}
      </Button>

      <div className="flex items-center gap-3 w-full sm:w-auto">
        <Button
          variant="outline"
          size="lg"
          onClick={onClearAll}
          disabled={!canStartScan || isScanning}
          iconName="Trash2"
          iconPosition="left"
          className="flex-1 sm:flex-none"
        >
          Clear
        </Button>

        <Button
          variant="ghost"
          size="lg"
          onClick={onViewHistory}
          iconName="History"
          iconPosition="left"
          className="flex-1 sm:flex-none"
        >
          History
        </Button>
      </div>
    </div>
  );
};

export default ScanActionButtons;
