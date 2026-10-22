import React from 'react';

const ProgressIndicator = ({ 
  value = 0, 
  max = 100, 
  variant = 'default',
  showLabel = true,
  label = '',
  size = 'default'
}) => {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  
  const getVariantClass = () => {
    switch (variant) {
      case 'success':
        return 'success';
      case 'warning':
        return 'warning';
      case 'error':
        return 'error';
      default:
        return '';
    }
  };

  const getSizeClass = () => {
    switch (size) {
      case 'sm':
        return 'h-1';
      case 'lg':
        return 'h-3';
      default:
        return 'h-2';
    }
  };

  return (
    <div className="w-full" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      {showLabel && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">
            {label || `Progress: ${Math.round(percentage)}%`}
          </span>
          <span className="text-sm text-muted-foreground">
            {Math.round(percentage)}%
          </span>
        </div>
      )}
      <div className={`progress-container ${getSizeClass()}`}>
        <div
          className={`progress-bar ${getVariantClass()}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

export default ProgressIndicator;
