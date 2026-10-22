import React from "react";
import { BrowserRouter, Routes as RouterRoutes, Route, Navigate } from "react-router-dom";
import ScrollToTop from "components/ScrollToTop";
import ErrorBoundary from "components/ErrorBoundary";
import ProtectedRoute from "components/ProtectedRoute";
import NotFound from "pages/NotFound";

// Public auth pages
import SignIn from "./pages/signin";
import SignUp from "./pages/signup";

// Protected app pages
import AIExplanationModal from "./pages/ai-explanation-modal";
import ScanResults from "./pages/scan-results";
import Dashboard from "./pages/dashboard";
import FileTreeExplorer from "./pages/file-tree-explorer";
import ScanProgress from "./pages/scan-progress";
import ScanHistory from "./pages/scan-history";
import NewScanSetup from "./pages/new-scan-setup";
import Profile from "./pages/profile";

const Routes = () => {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <ScrollToTop />
        <RouterRoutes>
          {/* ── Public routes (redirect to dashboard if already signed in) ── */}
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />

          {/* ── Root redirect ─────────────────────────────────────────────── */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* ── Protected routes ──────────────────────────────────────────── */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/ai-explanation-modal"
            element={
              <ProtectedRoute>
                <AIExplanationModal />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scan-results"
            element={
              <ProtectedRoute>
                <ScanResults />
              </ProtectedRoute>
            }
          />
          <Route
            path="/file-tree-explorer"
            element={
              <ProtectedRoute>
                <FileTreeExplorer />
              </ProtectedRoute>
            }
          />
          <Route
            path="/file-tree-explorer/:projectId"
            element={
              <ProtectedRoute>
                <FileTreeExplorer />
              </ProtectedRoute>
            }
          />
          <Route
            path="/file-tree-explorer/:projectId/:scanId"
            element={
              <ProtectedRoute>
                <FileTreeExplorer />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scan-progress"
            element={
              <ProtectedRoute>
                <ScanProgress />
              </ProtectedRoute>
            }
          />
          <Route
            path="/new-scan-setup"
            element={
              <ProtectedRoute>
                <NewScanSetup />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scan-history"
            element={
              <ProtectedRoute>
                <ScanHistory />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<NotFound />} />
        </RouterRoutes>
      </ErrorBoundary>
    </BrowserRouter>
  );
};

export default Routes;
