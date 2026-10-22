/**
 * SettingsNav — vertical sidebar navigation for the Account Settings page.
 *
 * Props:
 *   activeSection  — id of the currently-active section
 *   onSelect(id)   — callback when the user clicks a nav item
 */
import React from 'react';
import Icon from '../../../components/AppIcon';
import { cn } from '../../../utils/cn';

const NAV_ITEMS = [
  { id: 'profile',  label: 'Profile',            icon: 'User'         },
  { id: 'security', label: 'Security',            icon: 'Lock'         },
  { id: 'preferences', label: 'Preferences',     icon: 'Settings'     },
  { id: 'account',  label: 'Account Management', icon: 'Shield'       },
];

const SettingsNav = ({ activeSection, onSelect }) => {
  return (
    <nav
      aria-label="Settings sections"
      className="flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0"
    >
      {NAV_ITEMS.map((item) => {
        const isActive = activeSection === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors w-full text-left',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon
              name={item.icon}
              size={17}
              className={isActive ? 'text-primary' : 'text-muted-foreground'}
            />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default SettingsNav;
