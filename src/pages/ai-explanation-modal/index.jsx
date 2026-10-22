import React, { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import AIExplanationOverlay from '../../components/navigation/AIExplanationOverlay';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';

/**
 * Deep link to a single AI explanation.
 *
 * URL: /ai-explanation-modal?scan=<scanId>&finding=<findingId>
 *
 * The page used to render a completely mocked analysis (hardcoded SQL
 * injection / XSS / hardcoded-credential write-ups that had nothing to do
 * with the user's data).  It now renders the real overlay, which resolves
 * the finding on the server and — on request — generates the explanation
 * with the AI provider configured on the backend.
 */
const AIExplanationModal = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const scanId = useMemo(
    () => searchParams.get('scan') || searchParams.get('scan_id') || '',
    [searchParams],
  );
  const findingId = useMemo(
    () => searchParams.get('finding') || searchParams.get('finding_id') || '',
    [searchParams],
  );

  const hasTarget = Boolean(scanId && findingId);

  if (!hasTarget) {
    return (
      <AppShell
        headerTitle="AI explanation"
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'AI explanation' }]}
      >
        <div className="mx-auto flex max-w-md flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 bg-muted/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icon name="Search" size={30} color="var(--color-muted-foreground)" />
          </div>
          <h1 className="text-xl font-heading font-semibold text-foreground mb-2">
            No finding selected
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            Open an AI explanation from the scan results, the code explorer or the dashboard. The
            link contains the scan and the finding it belongs to.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Button variant="outline" onClick={() => navigate('/scan-results')}>
              Scan Results
            </Button>
            <Button onClick={() => navigate('/dashboard')}>Back to Dashboard</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      headerTitle="AI explanation"
      breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'AI explanation' }]}
    >
      <AIExplanationOverlay
        scanId={scanId}
        findingId={findingId}
        onClose={() => navigate(-1)}
      />
    </AppShell>
  );
};

export default AIExplanationModal;
