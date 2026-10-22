/**
 * Navigation configuration shared by the sidebar and the mobile drawer.
 *
 * `end` marks routes that should only be active on an exact match — used for
 * the dashboard so that `/dashboard/something` does not light up "Dashboard".
 */
export const NAV_SECTIONS = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard', end: true },
    ],
  },
  {
    id: 'scanning',
    label: 'Scanning',
    items: [
      { to: '/new-scan-setup', label: 'New Scan', icon: 'Plus' },
      { to: '/scan-progress', label: 'Scan Progress', icon: 'Activity' },
      { to: '/scan-results', label: 'Scan Results', icon: 'FileSearch' },
    ],
  },
  {
    id: 'explore',
    label: 'Explore',
    items: [
      { to: '/scan-history', label: 'Scan History', icon: 'History' },
      { to: '/file-tree-explorer', label: 'Code Explorer', icon: 'FolderTree' },
    ],
  },
];

export const NAV_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

export const PRODUCT_NAME = 'CodeGuard';
export const PRODUCT_TAGLINE = 'AI vulnerability scanner';
