/**
 * Dropdown — an accessible popup menu.
 *
 * Keyboard behaviour (WAI-ARIA menu button pattern):
 *   Enter / Space / ArrowDown  → open and focus the first item
 *   ArrowDown / ArrowUp        → move between items
 *   Home / End                 → first / last item
 *   Escape                     → close and return focus to the trigger
 *   Tab                        → close the menu
 *
 * Items are described by `{ label, icon, onSelect, disabled, danger, description }`.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '../AppIcon';
import { cn } from '../../utils/cn';

const Dropdown = ({
  trigger,
  items = [],
  align = 'right',
  className,
  menuClassName,
  buttonRef: externalButtonRef,
  label = 'Open menu',
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const buttonElement = externalButtonRef || buttonRef;

  const enabledIndexes = items
    .map((item, index) => (item && !item.disabled ? index : -1))
    .filter((index) => index !== -1);

  const close = useCallback(
    ({ returnFocus = true } = {}) => {
      setOpen(false);
      setActiveIndex(-1);
      if (returnFocus) buttonElement.current?.focus?.();
    },
    [buttonElement],
  );

  const openMenu = (focusIndex = 0) => {
    setOpen(true);
    if (enabledIndexes.length) {
      setActiveIndex(focusIndex === -1 ? enabledIndexes[0] : focusIndex);
    }
  };

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const node = menuRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    node?.focus?.();
  }, [open, activeIndex]);

  const selectItem = (item) => {
    if (!item || item.disabled) return;
    close({ returnFocus: false });
    item.onSelect?.();
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu(enabledIndexes[0]);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(enabledIndexes[enabledIndexes.length - 1]);
    }
  };

  const handleMenuKeyDown = (event) => {
    const currentPos = enabledIndexes.indexOf(activeIndex);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex(enabledIndexes[(currentPos + 1) % enabledIndexes.length]);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex(
          enabledIndexes[(currentPos - 1 + enabledIndexes.length) % enabledIndexes.length],
        );
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(enabledIndexes[0]);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(enabledIndexes[enabledIndexes.length - 1]);
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'Tab':
        close({ returnFocus: false });
        break;
      default:
        break;
    }
  };

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close({ returnFocus: false }) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className="inline-flex items-center"
      >
        {trigger}
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={handleMenuKeyDown}
          className={cn(
            'absolute z-[700] mt-1.5 min-w-[12rem] overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-elevation-3',
            align === 'right' ? 'right-0' : 'left-0',
            menuClassName,
          )}
        >
          {items.map((item, index) => {
            if (!item) return null;
            if (item.type === 'separator') {
              return (
                <div
                  key={item.key || `sep-${index}`}
                  role="separator"
                  className="my-1 h-px bg-border"
                />
              );
            }
            if (item.type === 'label') {
              return (
                <p
                  key={item.key || `label-${index}`}
                  className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                >
                  {item.label}
                </p>
              );
            }
            return (
              <button
                key={item.key || item.label || index}
                type="button"
                role="menuitem"
                data-index={index}
                disabled={item.disabled}
                tabIndex={-1}
                onClick={() => selectItem(item)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  'focus:outline-none focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  item.danger
                    ? 'text-error hover:bg-error/10 focus-visible:bg-error/10 focus-visible:ring-error/40'
                    : 'text-foreground hover:bg-muted focus-visible:bg-muted',
                )}
              >
                {item.icon ? (
                  <Icon name={item.icon} size={16} aria-hidden="true" className="shrink-0" />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {item.description ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  ) : null}
                </span>
                {item.shortcut ? (
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-data text-[10px] text-muted-foreground">
                    {item.shortcut}
                  </kbd>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default Dropdown;
