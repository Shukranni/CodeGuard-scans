/**
 * useSignOut — the shared sign-out flow.
 *
 * Signing out is destructive, so it always runs behind a confirmation. This
 * hook owns the dialog state and the actual teardown so every entry point
 * (the header account menu, the sidebar…) behaves identically:
 *
 *   confirmOpen    — is the confirmation dialog open?
 *   openConfirm    — ask the user to confirm
 *   closeConfirm   — dismiss the dialog
 *   signingOut     — is the sign-out request in flight?
 *   confirmSignOut — tear the session down and redirect to /signin
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export const useSignOut = ({ onSignedOut } = {}) => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const confirmSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setConfirmOpen(false);
      onSignedOut?.();
      navigate('/signin', { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  return {
    confirmOpen,
    openConfirm: () => setConfirmOpen(true),
    closeConfirm: () => setConfirmOpen(false),
    signingOut,
    confirmSignOut,
  };
};

export default useSignOut;
