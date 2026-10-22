/**
 * New scan — a three step wizard: upload, configure, review.
 *
 * The scan itself is created with `POST /api/scans/start/` using the body
 * `{ project_id, selected_scanners }`. The request is only ever sent once:
 * the button is disabled while a request is in flight.
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import PageHeader from '../../components/layout/PageHeader';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import UploadSection from './components/UploadSection';
import ProjectValidation from './components/ProjectValidation';
import ScannerSelection from './components/ScannerSelection';
import AdvancedOptions from './components/AdvancedOptions';
import ScanSummary from './components/ScanSummary';
import api from '../../utils/api';
import { useScanProgress } from '../../context/ScanProgressContext';
import { cn } from '../../utils/cn';

const STEPS = [
  { id: 1, label: 'Upload', description: 'Choose the project to scan', icon: 'Upload' },
  { id: 2, label: 'Configure', description: 'Pick the scanners to run', icon: 'SlidersHorizontal' },
  { id: 3, label: 'Review', description: 'Confirm and start the scan', icon: 'FileSearch' },
];

const NewScanSetup = () => {
  const navigate = useNavigate();
  const { initiateScan } = useScanProgress();
  const [currentStep, setCurrentStep] = useState(1);
  // Guards against double-submitting the scan creation request.
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState(null);

  const [configuration, setConfiguration] = useState({
    sourceType: null,
    file: null,
    repository: null,
    selectedScanners: ['semgrep', 'gitleaks', 'dependency'],
    advancedOptions: {
      pathExclusions: '**/node_modules/**, **/test/**, **/*.min.js',
      scanTimeout: 30,
      owaspCategories: ['a01', 'a02', 'a03', 'a05', 'a06', 'a07'],
      verboseLogging: false,
    },
    validationData: null,
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep]);

  const handleFileSelect = (file) => {
    setConfiguration((prev) => ({
      ...prev,
      sourceType: 'file',
      file,
      repository: null,
      // The previous source is no longer the one being scanned.
      validationData: null,
    }));
  };

  const handleRepositorySubmit = (repoData) => {
    setConfiguration((prev) => ({
      ...prev,
      sourceType: 'github',
      repository: repoData,
      file: null,
      validationData: null,
    }));
  };

  const handleScannerToggle = (scannerId) => {
    setConfiguration((prev) => ({
      ...prev,
      selectedScanners: prev?.selectedScanners?.includes(scannerId)
        ? prev?.selectedScanners?.filter((id) => id !== scannerId)
        : [...prev?.selectedScanners, scannerId],
    }));
  };

  const handleAdvancedOptionsChange = (options) => {
    setConfiguration((prev) => ({ ...prev, advancedOptions: options }));
  };

  /**
   * Turn a failed POST /api/scans/start/ into a precise, actionable message.
   * A session problem is never presented as a scan failure.
   */
  const describeStartError = (error) => {
    const status = error?.response?.status;
    const serverMessage = error?.response?.data?.error;
    if (status === 400) {
      return (
        serverMessage ||
        'The scan request was rejected. Please review your configuration and try again.'
      );
    }
    if (status === 404) {
      return 'Project not found. It may have been deleted or may belong to another account. Please re-upload your project.';
    }
    if (status === 401 || status === 403) {
      return 'Your session has expired. Please sign in again to start a scan.';
    }
    if (!error?.response) {
      return 'Cannot reach the server. Please check your connection and try again.';
    }
    return serverMessage || 'Failed to start the security scan. Please try again.';
  };

  const handleStartScan = async () => {
    // Never fire a second creation request while one is in flight — a
    // duplicate request would enqueue a duplicate scan on the server.
    if (isStarting) return;

    // The project id comes from the validation response; for a repository it
    // is also kept on the repository configuration itself.
    const projectId = configuration?.validationData?.id || configuration?.repository?.projectId;
    if (!projectId) {
      setStartError('Project ID not found. Please re-upload your project.');
      return;
    }
    if (!configuration?.selectedScanners?.length) {
      setStartError('Select at least one scanner before starting the scan.');
      return;
    }

    setStartError(null);
    setIsStarting(true);

    try {
      const response = await api.post('/api/scans/start/', {
        project_id: projectId,
        selected_scanners: configuration.selectedScanners,
      });

      const scanId = response.data?.id;
      if (!scanId) {
        throw new Error('Server did not return a scan id.');
      }

      initiateScan({
        id: scanId,
        status: response.data?.status || 'queued',
        projectName: configuration?.validationData?.projectName || 'New Scan',
        scanners: configuration.selectedScanners,
        projectData: {
          id: projectId,
          ...configuration,
        },
      });

      // The scan was accepted and queued — move to the live progress page.
      navigate('/scan-progress', { state: { scanId } });
    } catch (error) {
      setIsStarting(false);
      setStartError(describeStartError(error));
    }
  };

  const canProceedToNextStep = () => {
    if (currentStep === 1) {
      return Boolean(configuration?.validationData?.isValid);
    }
    if (currentStep === 2) {
      return (configuration?.selectedScanners?.length || 0) > 0;
    }
    return true;
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-5">
            <UploadSection
              onFileSelect={handleFileSelect}
              onRepositorySubmit={handleRepositorySubmit}
              onValidationComplete={(validationData) =>
                setConfiguration((prev) => ({ ...prev, validationData }))
              }
            />
            {configuration?.validationData ? (
              <ProjectValidation validationData={configuration.validationData} />
            ) : null}
          </div>
        );

      case 2:
        return (
          <div className="space-y-5">
            <ScannerSelection
              selectedScanners={configuration?.selectedScanners}
              onScannerToggle={handleScannerToggle}
            />
            <AdvancedOptions
              options={configuration?.advancedOptions}
              onOptionsChange={handleAdvancedOptionsChange}
            />
          </div>
        );

      case 3:
        return (
          <ScanSummary
            configuration={{
              ...configuration,
              ...configuration?.advancedOptions,
            }}
          />
        );

      default:
        return null;
    }
  };

  return (
    <AppShell headerTitle="New scan">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow={`Step ${currentStep} of ${STEPS.length}`}
          title="Configure a new scan"
          description="Upload the project you want to analyse, choose the scanners to run and start the scan."
        />

        {/* ── Step indicator ────────────────────────────────────────────── */}
        <ol className="grid grid-cols-3 gap-2" aria-label="Scan setup steps">
          {STEPS.map((item) => {
            const isCurrent = item.id === currentStep;
            const isDone = item.id < currentStep;
            return (
              <li key={item.id} className="min-w-0">
                <div
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cn(
                    'rounded-lg border px-3 py-2.5 transition-colors duration-150',
                    isCurrent
                      ? 'border-primary/50 bg-primary/5'
                      : isDone
                        ? 'border-border bg-card'
                        : 'border-dashed border-border bg-transparent',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                        isCurrent
                          ? 'bg-primary text-primary-foreground'
                          : isDone
                            ? 'bg-success/10 text-success'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {isDone ? (
                        <Icon name="Check" size={13} strokeWidth={3} aria-hidden="true" />
                      ) : (
                        item.id
                      )}
                    </span>
                    <span
                      className={cn(
                        'truncate text-sm font-medium',
                        isCurrent ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {item.label}
                    </span>
                  </div>
                  <p className="mt-1 hidden text-xs text-muted-foreground sm:block">
                    {item.description}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        {/* ── Step content ──────────────────────────────────────────────── */}
        <div>{renderStepContent()}</div>

        {startError ? (
          <Alert
            variant="error"
            title="The scan could not be started"
            onDismiss={() => setStartError(null)}
          >
            <p>{startError}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Nothing was queued on the server. Fix the issue above, then try again.
            </p>
          </Alert>
        ) : null}

        {/* ── Wizard actions ────────────────────────────────────────────── */}
        <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-background/90 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-xl sm:border sm:px-4 md:px-5">
          <div className="flex items-center gap-2">
            {currentStep > 1 ? (
              <Button
                variant="outline"
                iconName="ChevronLeft"
                iconPosition="left"
                onClick={() => setCurrentStep((prev) => prev - 1)}
                disabled={isStarting}
              >
                Back
              </Button>
            ) : null}
            <Button
              variant="ghost"
              iconName="X"
              iconPosition="left"
              onClick={() => navigate('/dashboard')}
              disabled={isStarting}
            >
              Cancel
            </Button>
          </div>

          {currentStep < STEPS.length ? (
            <Button
              iconName="ChevronRight"
              iconPosition="right"
              onClick={() => setCurrentStep((prev) => prev + 1)}
              disabled={!canProceedToNextStep()}
            >
              Continue to {STEPS.find((item) => item.id === currentStep + 1)?.label.toLowerCase()}
            </Button>
          ) : (
            <Button
              iconName="Play"
              iconPosition="left"
              onClick={handleStartScan}
              disabled={!canProceedToNextStep() || isStarting}
              loading={isStarting}
            >
              {isStarting ? 'Starting…' : 'Start security scan'}
            </Button>
          )}
        </div>

        {/* ── Busy overlay ──────────────────────────────────────────────── */}
        {isStarting ? (
          <div
            role="status"
            aria-live="assertive"
            className="fixed inset-0 z-[1040] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          >
            <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-elevation-3">
              <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon name="Loader" size={26} aria-hidden="true" className="animate-spin" />
              </span>
              <h2 className="text-base font-semibold text-foreground">Creating your scan</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Queuing the scan on the server. You will be taken to the progress page as soon as
                it is accepted.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
};

export default NewScanSetup;
