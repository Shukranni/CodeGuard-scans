/**
 * Tooltip — a short, supplementary hint attached to a trigger.
 *
 * • Opens on hover *and* on keyboard focus.
 * • Closes on Escape and when the trigger loses focus.
 * • The trigger keeps its own accessible name; the tooltip is wired up with
 *   `aria-describedby` so it is announced as a description, not a label.
 * • Tooltips are never the only place information exists — use `label` for
 *   anything the user must be able to act on.
 */
import React, { useState, useRef, useId, useCallback } from 'react';
import { cn } from '../../utils/cn';

const Tooltip = ({
  children,
  content,
  side = 'top',
  className,
  disabled = false,
  delay = 120,
}) => {
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const id = useId();
  const tooltipId = `cg-tooltip-${id}`;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = () => {
    if (disabled || !content) return;
    clearTimer();
    timerRef.current = setTimeout(() => setOpen(true), delay);
  };

  const hide = () => {
    clearTimer();
    setOpen(false);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') hide();
  };

  const positionClass = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[side];

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={handleKeyDown}
    >
      <span aria-describedby={open ? tooltipId : undefined} className="inline-flex">
        {children}
      </span>
      {open && content ? (
        <span
          id={tooltipId}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-[600] w-max max-w-xs rounded-lg px-2.5 py-1.5 text-xs font-medium shadow-lg',
            'bg-foreground text-background',
            positionClass,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
};

export default Tooltip;
