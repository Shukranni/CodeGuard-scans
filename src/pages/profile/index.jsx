/**
 * Account Settings page — redesigned.
 *
 * Layout:
 *   - The application shell (header + side navigation)
 *   - Page header with a breadcrumb back to Dashboard
 *   - Responsive two-column layout: section nav on the left, panel on the right
 *
 * Sections:
 *   1. Profile           — edit name; email is read-only
 *   2. Security          — change password + sign-out
 *   3. Preferences       — dark mode toggle
 *   4. Account Management — account info + sign-out
 *
 * All sections are connected to the real backend. Non-functional decorative
 * elements (2FA, active sessions, notification toggles, fake delete button)
 * have been removed.
 */
import React, { useState } from 'react';
import AppShell from '../../components/layout/AppShell';
import PageHeader from '../../components/layout/PageHeader';
import SettingsNav from './components/SettingsNav';
import ProfileSection from './components/ProfileSection';
import SecuritySection from './components/SecuritySection';
import PreferencesSection from './components/PreferencesSection';
import AccountManagementSection from './components/AccountManagementSection';

const SECTIONS = {
  profile:     <ProfileSection />,
  security:    <SecuritySection />,
  preferences: <PreferencesSection />,
  account:     <AccountManagementSection />,
};

const Profile = () => {
  const [activeSection, setActiveSection] = useState('profile');

  return (
    <AppShell
      headerTitle="Account settings"
      breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Account settings' }]}
    >
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Account settings"
          description="Manage your profile, security, and application preferences."
        />

        {/* ── Main layout ──────────────────────────────────────────────────── */}
        <div className="mt-6 flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">

          {/* Section nav */}
          <aside className="w-full lg:w-48 flex-shrink-0">
            {/* Mobile: horizontal pill row; Desktop: vertical list */}
            <div className="bg-card border border-border rounded-lg p-2">
              <SettingsNav
                activeSection={activeSection}
                onSelect={setActiveSection}
              />
            </div>
          </aside>

          {/* Section panel */}
          <div className="flex-1 min-w-0">
            <div className="bg-card border border-border rounded-lg p-6 lg:p-8">
              {SECTIONS[activeSection] ?? <ProfileSection />}
            </div>
          </div>

        </div>
      </div>
    </AppShell>
  );
};

export default Profile;
