/**
 * SignOutConfirmDialog — the confirmation shown before a session is ended.
 *
 * Kept separate from the trigger so a dropdown item and a sidebar button can
 * both open the very same dialog.
 */
import React from 'react';
import ConfirmDialog from '../ui/ConfirmDialog';

const SignOutConfirmDialog = ({ isOpen, onClose, onConfirm, loading = false }) => (
  <ConfirmDialog
    isOpen={isOpen}
    onClose={onClose}
    onConfirm={onConfirm}
    title="Sign out of CodeGuard?"
    description="Your saved scans stay in your account. You will need to sign in again to view them."
    confirmLabel="Sign out"
    cancelLabel="Stay signed in"
    variant="destructive"
    loading={loading}
  />
);

export default SignOutConfirmDialog;
