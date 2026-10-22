/**
 * Tabs — an accessible tab group.
 *
 * Implemented from scratch (no headless-ui dependency) but follows the WAI-ARIA
 * authoring practices:
 *   • `role="tablist"` with `aria-orientation`
 *   • each tab is `role="tab"` with `aria-selected` and `aria-controls`
 *   • each panel is `role="tabpanel"` with `aria-labelledby`
 *   • roving tabindex — only the active tab is in the tab order
 *   • arrow keys move between tabs, Home/End jump to the first/last
 */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import Icon from '../AppIcon';
import { cn } from '../../utils/cn';

const Tabs = ({
  tabs = [],
  value,
  defaultValue,
  onChange,
  className,
  listClassName,
  variant = 'underline',
  ariaLabel = 'Tabs',
}) => {
  const items = tabs.filter(Boolean);
  const [internalValue, setInternalValue] = useState(
    defaultValue ?? items[0]?.value ?? null,
  );
  const isControlled = value !== undefined;
  const activeValue = isControlled ? value : internalValue;
  const listRef = useRef(null);

  const activeIndex = Math.max(
    items.findIndex((tab) => tab.value === activeValue),
    0,
  );

  const select = useCallback(
    (nextValue) => {
      if (!isControlled) setInternalValue(nextValue);
      onChange?.(nextValue);
    },
    [isControlled, onChange],
  );

  const focusTabAt = useCallback(
    (index) => {
      const bounded = (index + items.length) % items.length;
      const tab = items[bounded];
      if (!tab) return;
      select(tab.value);
      const node = listRef.current?.querySelector(`#${CSS.escape(tab.id || `cg-tab-${tab.value}`)}`);
      node?.focus();
    },
    [items, select],
  );

  const handleKeyDown = (event, index) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusTabAt(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusTabAt(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusTabAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusTabAt(items.length - 1);
        break;
      default:
        break;
    }
  };

  const activeTab = items[activeIndex];

  return (
    <div className={cn('min-w-0', className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          'flex items-center gap-1 overflow-x-auto',
          variant === 'underline'
            ? 'border-b border-border'
            : 'rounded-lg border border-border bg-muted/40 p-1',
          listClassName,
        )}
      >
        {items.map((tab, index) => {
          const isActive = tab.value === activeValue;
          const tabId = tab.id || `cg-tab-${tab.value}`;
          return (
            <button
              key={tab.value}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`${tabId}-panel`}
              tabIndex={isActive ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => select(tab.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                'inline-flex items-center gap-2 whitespace-nowrap text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                'disabled:cursor-not-allowed disabled:opacity-50',
                variant === 'underline'
                  ? cn(
                      '-mb-px border-b-2 px-3 py-2.5',
                      isActive
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                    )
                  : cn(
                      'rounded-md px-3 py-1.5',
                      isActive
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    ),
                tab.className,
              )}
            >
              {tab.icon ? <Icon name={tab.icon} size={16} aria-hidden="true" /> : null}
              <span>{tab.label}</span>
              {typeof tab.count === 'number' ? (
                <span
                  className={cn(
                    'ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none',
                    isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {activeTab ? (
        <div
          id={`${activeTab.id || `cg-tab-${activeTab.value}`}-panel`}
          role="tabpanel"
          aria-labelledby={activeTab.id || `cg-tab-${activeTab.value}`}
          tabIndex={0}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {typeof activeTab.content === 'function' ? activeTab.content() : activeTab.content}
        </div>
      ) : null}
    </div>
  );
};

export default Tabs;
