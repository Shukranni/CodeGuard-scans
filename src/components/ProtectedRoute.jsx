/**
 * ProtectedRoute — redirects unauthenticated users to /signin.
 * Shows a loading spinner while the initial auth-restore is in flight.
 */
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Icon from './AppIcon';

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center animate-pulse">
            <Icon name="Shield" size={28} color="var(--color-primary)" />
          </div>
          <p className="text-sm text-muted-foreground animate-pulse">Authenticating…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Preserve the intended destination so we can redirect after sign-in
    return <Navigate to="/signin" state={{ from: location }} replace />;
  }

  return children;
};

export default ProtectedRoute;
