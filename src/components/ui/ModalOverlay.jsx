/**
 * ModalOverlay — the base modal surface used by every dialog in the app.
 *
 * Accessibility contract
 *   • `role="dialog"` + `aria-modal="true"` on the dialog element itself
 *   • the dialog is labelled by its title (`aria-labelledby`) and described by
 *     its optional description (`aria-describedby`)
 *   • focus is moved into the dialog on open and restored to the trigger on
 *     close
 *   • Tab / Shift+Tab are trapped inside the dialog
 *   • Escape closes the dialog, and the backdrop is click-to-dismiss
 *   • background scrolling is locked while the dialog is open
 */
import React, { useEffect, useRef } from 'react';
import Icon from '../AppIcon';
import { cn } from '../../utils/cn';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const ModalOverlay = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 'max-w-4xl',
  showCloseButton = true,
  closeOnBackdrop = true,
  className,
  bodyClassName,
  initialFocusRef,
}) => {
  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);
  const titleId = 'cg-modal-title';
  const descriptionId = 'cg-modal-description';

  useEffect(() => {
    if (!isOpen) return undefined;

    previousFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTarget =
      initialFocusRef?.current ||
      modalRef.current?.querySelector(FOCUSABLE_SELECTOR) ||
      modalRef.current;
    // Defer so the element is laid out before focus is moved.
    const frame = requestAnimationFrame(() => focusTarget?.focus?.());

    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      const previous = previousFocusRef.current;
      if (previous && typeof previous.focus === 'function') {
        previous.focus();
      }
    };
  }, [isOpen, initialFocusRef]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const handleOverlayClick = (event) => {
    if (closeOnBackdrop && event.target === event.currentTarget) {
      onClose?.();
    }
  };

  const handleModalKeyDown = (event) => {
    if (event.key !== 'Tab') return;

    const focusable = Array.from(
      modalRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || [],
    ).filter((element) => element.offsetParent !== null || element === document.activeElement);

    if (focusable.length === 0) {
      event.preventDefault();
      modalRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay animate-fade-in" onClick={handleOverlayClick}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn('modal-content animate-scale-in', maxWidth, className)}
        onKeyDown={handleModalKeyDown}
      >
        {title || showCloseButton ? (
          <div className="modal-header">
            <div className="min-w-0">
              {title ? (
                <h2 id={titleId} className="modal-title">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            {showCloseButton ? (
              <button
                className="modal-close"
                onClick={onClose}
                aria-label="Close dialog"
                type="button"
              >
                <Icon name="X" size={20} />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={cn('modal-body', bodyClassName)}>{children}</div>

        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
};

export default ModalOverlay;
