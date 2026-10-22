/**
 * ConfirmDialog — a modal that asks the user to confirm a consequential action.
 *
 * The destructive variant is never signalled by colour alone: the icon, the
 * title and the confirm button label all state what is about to happen.
 */
import React, { useRef } from 'react';
import ModalOverlay from './ModalOverlay';
import Button from './Button';
import Icon from '../AppIcon';
import { cn } from '../../utils/cn';

const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
  children,
}) => {
  const confirmRef = useRef(null);
  const isDestructive = variant === 'destructive';

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="max-w-md"
      initialFocusRef={confirmRef}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={isDestructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            loading={loading}
            iconName={isDestructive ? 'AlertTriangle' : undefined}
            iconPosition="left"
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex gap-4">
        {isDestructive ? (
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
              'bg-error/10 text-error',
            )}
            aria-hidden="true"
          >
            <Icon name="AlertTriangle" size={20} />
          </span>
        ) : null}
        <div className="min-w-0 text-sm text-muted-foreground">
          {description ? <p>{description}</p> : null}
          {children}
        </div>
      </div>
    </ModalOverlay>
  );
};

export default ConfirmDialog;
