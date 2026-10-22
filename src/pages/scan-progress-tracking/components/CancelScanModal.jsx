import React from 'react';
import ModalOverlay from '../../../components/ui/ModalOverlay';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';

const CancelScanModal = ({ isOpen, onClose, onConfirm, isProcessing }) => {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onClose}
      title="Cancel Scan"
      maxWidth="max-w-md"
    >
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0">
            <Icon name="AlertTriangle" size={24} color="var(--color-warning)" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Are you sure you want to cancel this scan?
            </h3>
            <p className="text-sm text-muted-foreground">
              Canceling the scan will stop all running security scanners and discard any partial results. This action cannot be undone.
            </p>
          </div>
        </div>

        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Icon name="Info" size={16} color="var(--color-accent)" />
            <span className="font-medium text-foreground">What happens next:</span>
          </div>
          <ul className="space-y-1 text-sm text-muted-foreground ml-6">
            <li className="flex items-start gap-2">
              <span className="text-accent mt-1">•</span>
              <span>All active scanners will be terminated immediately</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-1">•</span>
              <span>Partial scan results will not be saved</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-1">•</span>
              <span>You can start a new scan from the upload interface</span>
            </li>
          </ul>
        </div>

        <div className="flex items-center gap-3 justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isProcessing}
          >
            Continue Scanning
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            loading={isProcessing}
            iconName="XCircle"
            iconPosition="left"
          >
            Cancel Scan
          </Button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default CancelScanModal;
