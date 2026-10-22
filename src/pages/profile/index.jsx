/**
 * Account Settings page — redesigned.
 *
 * Layout:
 *   - Fixed app header (from Header component)
 *   - Page header with breadcrumb back to Dashboard
 *   - Responsive two-column layout: sidebar nav on the left, section panel on the right
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
import { Link } from 'react-router-dom';
import Icon from '../../components/AppIcon';
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
    <div className="min-h-screen bg-background text-foreground pt-20 pb-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* ── Back navigation ─────────────────────────────────────────────── */}
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <Icon name="ArrowLeft" size={16} />
          <span>Back to Dashboard</span>
        </Link>

        {/* ── Page header ──────────────────────────────────────────────────── */}
        <div className="mb-8">
          <h1 className="text-2xl font-heading font-semibold text-foreground mb-1">
            Account Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage your profile, security, and application preferences.
          </p>
        </div>

        {/* ── Main layout ──────────────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">

          {/* Sidebar nav */}
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
          <main className="flex-1 min-w-0">
            <div className="bg-card border border-border rounded-lg p-6 lg:p-8">
              {SECTIONS[activeSection] ?? <ProfileSection />}
            </div>
          </main>

        </div>
      </div>
    </div>
  );
};

export default Profile;
