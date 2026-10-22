/**
 * Scan Progress — live view of a running security scan.
 *
 * Everything rendered here comes from the server:
 *   GET /api/scans/<id>/status/   → the authoritative lifecycle snapshot
 *   GET /api/scans/<id>/          → optional validation metadata
 *
 * There is no simulated progress anywhere: the bar, the stage list, the
 * scanner states and the event log are all derived from the real snapshot.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import PageHeader from '../../components/layout/PageHeader';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import { Skeleton, LoadingRegion } from '../../components/ui/Skeleton';
import ProgressStageIndicator from './components/ProgressStageIndicator';
import ScannerStatusPanel from './components/ScannerStatusPanel';
import ScanMetadata from './components/ScanMetadata';
import ScanActions from './components/ScanActions';
import ScanLogs from './components/ScanLogs';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useScanProgress } from '../../context/ScanProgressContext';
import { getCurrentUserId } from '../../utils/persistenceUtils';

// ── Polling configuration ─────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 2000;      // single timer, chained — requests never overlap
const MAX_BACKOFF_MS = 15000;       // ceiling for exponential backoff on failures
const MAX_CONSECUTIVE_POLL_FAILURES = 5; // then stop and offer a manual retry
const SUCCESS_STATUSES = ['completed', 'completed_with_warnings'];

const STATUS_LABELS = {
  pending: 'Pending',
  queued: 'Queued',
  preparing: 'Preparing',
  running: 'Running',
  completed: 'Completed',
  completed_with_warnings: 'Completed with warnings',
  failed: 'Failed',
  resolved: 'Resolved',
};

const SCANNER_LABELS = {
  semgrep: 'Semgrep (static analysis)',
  gitleaks: 'GitLeaks (secret detection)',
  dependency: 'npm audit (dependency vulnerabilities)',
};

const STAGE_MESSAGES = {
  queued: 'Scan queued — waiting for a background worker',
  validating_archive: 'Worker claimed the scan — validating the uploaded archive',
  extracting: 'Archive validated — extracting files into an isolated directory',
  running: 'Scanners running',
  done: 'Scan finished — results persisted',
  failed: 'Scan failed',
};

/**
 * Resolve the scan to display without ever creating one:
 *   1. router state (set right after scan creation),
 *   2. ScanProgressContext (persisted in localStorage — survives refresh),
 *   3. legacy user-scoped / un-namespaced activeScan keys.
 */
const resolveInitialScanId = (locationState, scanState) => {
  if (locationState?.scanId) return String(locationState.scanId);
  if (scanState?.id && scanState.id !== 'new_scan') return String(scanState.id);
  const userId = getCurrentUserId();
  const userKey = userId ? `activeScan_${userId}` : null;
  if (userKey) {
    try {
      const stored = JSON.parse(localStorage.getItem(userKey));
      if (stored?.id && stored.id !== 'new_scan') return String(stored.id);
    } catch { /* ignore malformed legacy data */ }
  }
  try {
    const legacy = JSON.parse(localStorage.getItem('activeScan'));
    if (legacy?.id && legacy.id !== 'new_scan') return String(legacy.id);
  } catch { /* ignore malformed legacy data */ }
  return null;
};

/** Real event log: entries are appended only when the status actually changes. */
const diffSnapshotLogs = (prev, next) => {
  const entries = [];
  const label = STATUS_LABELS[next.status] || next.status;

  if (!prev) {
    entries.push({ level: 'info', message: `Loaded scan status: ${label}` });
    if (next.stage && next.stage !== 'queued' && STAGE_MESSAGES[next.stage]) {
      entries.push({ level: 'info', message: STAGE_MESSAGES[next.stage] });
    }
  } else {
    if (prev.status !== next.status) {
      entries.push({
        level: 'info',
        message: `Status: ${STATUS_LABELS[prev.status] || prev.status} → ${label}`,
      });
    }
    if (prev.stage !== next.stage && next.stage && STAGE_MESSAGES[next.stage]) {
      const fromScannerStage = typeof prev.stage === 'string' && prev.stage.startsWith('running:');
      if (!(next.stage === 'running' && fromScannerStage)) {
        entries.push({ level: 'info', message: STAGE_MESSAGES[next.stage] });
      }
    }
    if (prev.worker_online !== next.worker_online) {
      entries.push(
        next.worker_online
          ? { level: 'success', message: 'Scan worker is online' }
          : {
              level: 'warning',
              message: 'Scan worker went offline — it is being restarted automatically',
            },
      );
    }
    const prevStates = prev.scanner_status || {};
    const nextStates = next.scanner_status || {};
    Object.keys(nextStates).forEach((name) => {
      if (prevStates[name] === nextStates[name]) return;
      const scannerLabel = SCANNER_LABELS[name] || name;
      switch (nextStates[name]) {
        case 'running':
          entries.push({ level: 'info', message: `Running ${scannerLabel}` });
          break;
        case 'completed':
          entries.push({ level: 'success', message: `${scannerLabel} finished` });
          break;
        case 'skipped':
          entries.push({ level: 'warning', message: `${scannerLabel} skipped — not applicable to this project` });
          break;
        case 'failed':
          entries.push({ level: 'error', message: `${scannerLabel} failed to execute (an execution error, not a finding)` });
          break;
        default:
          break;
      }
    });
  }

  const reachedTerminal = next.is_terminal && (!prev || prev.status !== next.status);
  if (reachedTerminal) {
    if (next.status === 'failed') {
      entries.push({ level: 'error', message: next.error ? `Scan failed: ${next.error}` : 'Scan failed' });
    } else if (next.status === 'completed_with_warnings') {
      entries.push({ level: 'warning', message: next.error ? `Completed with warnings: ${next.error}` : 'Completed with warnings' });
    } else {
      entries.push({ level: 'success', message: 'Scan completed successfully' });
    }
  }
  return entries;
};

/**
 * Build the stage list from a real status snapshot — every value shown is
 * derived from the backend lifecycle, never simulated.
 */
const buildStages = (snap) => {
  if (!snap) return [];
  const ranks = { pending: 0, queued: 0, preparing: 1, running: 2 };
  const rank = ranks[snap.status] ?? 3;
  const failed = snap.status === 'failed';
  const scannerStates = snap.scanner_status || {};
  const scanners = snap.scanners || [];
  const reachedRunning = rank >= 2 || scanners.some((name) => scannerStates[name] && scannerStates[name] !== 'pending');

  const stages = [
    {
      id: 'queued',
      name: 'Queued',
      icon: 'Clock',
      description: 'Scan accepted and waiting for a background scan worker',
      status: failed && !reachedRunning && rank === 0 ? 'failed' : rank > 0 ? 'completed' : 'active',
    },
    {
      id: 'preparing',
      name: 'Preparing',
      icon: 'Settings',
      description: 'Validating and safely extracting the uploaded archive',
      status: failed && !reachedRunning
        ? 'failed'
        : rank > 1
          ? 'completed'
          : rank === 1
            ? 'active'
            : 'pending',
    },
  ];

  scanners.forEach((name) => {
    const state = scannerStates[name] || 'pending';
    let status = 'pending';
    if (state === 'completed') status = 'completed';
    else if (state === 'failed') status = 'failed';
    else if (state === 'skipped') status = 'skipped';
    else if (state === 'running' || snap.stage === `running:${name}`) status = 'active';
    stages.push({
      id: `scanner-${name}`,
      name: SCANNER_LABELS[name] || name,
      icon: name === 'semgrep' ? 'Code' : name === 'gitleaks' ? 'Key' : 'Package',
      description:
        name === 'semgrep'
          ? 'Static code analysis for security vulnerabilities'
          : name === 'gitleaks'
            ? 'Detection of committed secrets and credentials'
            : 'Checking package manifests for known vulnerabilities',
      status,
    });
  });

  stages.push({
    id: 'results',
    name: 'Results',
    icon: 'FileText',
    description: 'Persisting results and finalizing the report',
    status: snap.is_terminal ? (failed ? 'failed' : 'completed') : 'pending',
  });

  return stages;
};

const formatDuration = (totalSeconds) => {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

const ScanProgress = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isLoading: authLoading } = useAuth();
  const { scanState, updateScanProgress, completeScan, initiateScan, clearProgress } = useScanProgress();

  const [scanId, setScanId] = useState(() => resolveInitialScanId(location.state, scanState));
  const [snapshot, setSnapshot] = useState(null);
  const [detail, setDetail] = useState(null);
  const [logs, setLogs] = useState([]);
  // kind: 'auth' | 'not-found' | 'network' | null
  const [pollError, setPollError] = useState(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  // Bumping this restarts the polling effect (manual "retry connection").
  const [resumeToken, setResumeToken] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [isRetryingScan, setIsRetryingScan] = useState(false);
  const [retryError, setRetryError] = useState(null);

  const lastSnapRef = useRef(null);
  const terminalHandledRef = useRef(false);
  const navTimerRef = useRef(null);
  const logSeqRef = useRef(0);

  // ── Polling: one chained timer per scan; stops on terminal or unmount ─────
  useEffect(() => {
    if (authLoading || !scanId) return undefined;

    let cancelled = false;
    let timerId = null;
    let consecutiveFailures = 0;

    const schedule = (delayMs) => {
      if (!cancelled) timerId = setTimeout(runPoll, delayMs);
    };

    const applySnapshot = (snap) => {
      if (cancelled) return;
      const prev = lastSnapRef.current;
      lastSnapRef.current = snap;
      setSnapshot(snap);
      setNow(Date.now());

      const entries = diffSnapshotLogs(prev, snap);
      if (entries.length > 0) {
        const stamped = entries.map((entry, index) => ({
          ...entry,
          id: `log-${logSeqRef.current++}-${Date.now()}-${index}`,
          timestamp: new Date(),
        }));
        setLogs((current) => [...current, ...stamped]);
      }

      // Keep the floating progress indicator in sync with real values.
      updateScanProgress({
        id: snap.id,
        overallProgress: snap.progress ?? 0,
        scanStatus: snap.status,
      });

      if (snap.is_terminal && !terminalHandledRef.current) {
        terminalHandledRef.current = true;
        completeScan();
        if (snap.status === 'completed') {
          navTimerRef.current = setTimeout(() => {
            navigate('/scan-results', { state: { scanId: snap.id } });
          }, 3000);
        }
      }
    };

    const runPoll = async () => {
      if (cancelled) return;
      try {
        const res = await api.get(`/api/scans/${scanId}/status/`);
        if (cancelled) return;
        consecutiveFailures = 0;
        setFailedAttempts(0);
        setPollError(null);
        const snap = res.data;
        applySnapshot(snap);
        if (snap.is_terminal) return; // terminal — the timer simply stops
        schedule(POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        const statusCode = err?.response?.status;
        if (statusCode === 404) {
          setPollError({ kind: 'not-found' });
          return;
        }
        if (statusCode === 401 || statusCode === 403) {
          // Incomplete/expired auth — never reported as a failed scan.
          setPollError({ kind: 'auth' });
          return;
        }
        consecutiveFailures += 1;
        setFailedAttempts(consecutiveFailures);
        if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          setPollError({ kind: 'network', message: err?.message || 'Network error' });
          return;
        }
        schedule(Math.min(POLL_INTERVAL_MS * 2 ** consecutiveFailures, MAX_BACKOFF_MS));
      }
    };

    runPoll();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, scanId, resumeToken]);

  // ── One-time fetch of the full scan record for validation metadata ─────────
  useEffect(() => {
    if (authLoading || !scanId) return undefined;
    let cancelled = false;
    api.get(`/api/scans/${scanId}/`)
      .then((res) => { if (!cancelled) setDetail(res.data); })
      .catch(() => { /* status polling is authoritative; metadata is optional */ });
    return () => { cancelled = true; };
  }, [authLoading, scanId]);

  // Clear the scheduled auto-navigation if the page unmounts first.
  useEffect(() => () => {
    if (navTimerRef.current) clearTimeout(navTimerRef.current);
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleRetryConnection = () => {
    setPollError(null);
    setFailedAttempts(0);
    setResumeToken((token) => token + 1);
  };

  const handleScanNotFound = () => {
    clearProgress();
    lastSnapRef.current = null;
    setSnapshot(null);
    setDetail(null);
    setLogs([]);
    setScanId(null);
    setPollError(null);
  };

  const handleRetryScan = async () => {
    if (isRetryingScan) return;
    const projectId = scanState?.projectData?.id;
    const scanners = scanState?.scanners?.length ? scanState.scanners : (snapshot?.scanners || []);
    if (!projectId || !scanners.length) {
      setRetryError('The original scan configuration is no longer available. Please start a new scan.');
      return;
    }

    setRetryError(null);
    setIsRetryingScan(true);
    try {
      const res = await api.post('/api/scans/start/', {
        project_id: projectId,
        selected_scanners: scanners,
      });
      const newScanId = res.data?.id;
      if (!newScanId) throw new Error('Server did not return a scan id.');

      if (navTimerRef.current) clearTimeout(navTimerRef.current);
      lastSnapRef.current = null;
      terminalHandledRef.current = false;
      setSnapshot(null);
      setDetail(null);
      setLogs([]);
      setPollError(null);
      setFailedAttempts(0);

      initiateScan({
        id: newScanId,
        status: res.data?.status || 'queued',
        projectName: scanState?.projectName || snapshot?.project_name || 'New Scan',
        scanners,
        projectData: scanState?.projectData || { id: projectId },
      });
      setScanId(String(newScanId));
    } catch (error) {
      console.error('Error retrying scan:', error);
      const status = error?.response?.status;
      const serverMessage = error?.response?.data?.error;
      if (status === 400) setRetryError(serverMessage || 'The scan request was rejected.');
      else if (!error?.response) setRetryError('Cannot reach the server. Check your connection and try again.');
      else setRetryError(serverMessage || 'Failed to start a new scan. Please try again.');
    } finally {
      setIsRetryingScan(false);
    }
  };

  // ── Derived view data ──────────────────────────────────────────────────────
  const isTerminal = !!snapshot?.is_terminal;
  const isSuccessTerminal = isTerminal && SUCCESS_STATUSES.includes(snapshot?.status);

  const elapsedSeconds = (() => {
    if (!snapshot?.started_at) return 0;
    const started = new Date(snapshot.started_at).getTime();
    const end = snapshot.completed_at ? new Date(snapshot.completed_at).getTime() : now;
    return Math.max(0, Math.floor((end - started) / 1000));
  })();

  const stages = buildStages(snapshot);
  const workerOffline = !!snapshot && !snapshot.worker_online && !isTerminal;

  const metadata = snapshot
    ? {
        scanId: String(snapshot.id),
        projectName: snapshot.project_name || detail?.project_name || scanState?.projectName || 'Project',
        statusLabel: STATUS_LABELS[snapshot.status] || snapshot.status,
        stage: snapshot.stage,
        startTime: snapshot.started_at,
        elapsedTime: formatDuration(elapsedSeconds),
        workerOnline: snapshot.worker_online,
        sourceType: scanState?.projectData?.sourceType || null,
        fileCount: detail?.result?.validation?.fileCount ?? null,
        totalSize: detail?.result?.validation?.totalSize ?? null,
        languages: detail?.result?.validation?.languages ?? null,
      }
    : null;

  const heading = (() => {
    if (pollError?.kind === 'auth') return 'Sign in required';
    if (pollError?.kind === 'not-found') return 'Scan not found';
    if (!scanId) return 'No active scan';
    if (!snapshot) return 'Loading scan status';
    if (snapshot.status === 'failed') return 'Scan failed';
    if (snapshot.status === 'completed_with_warnings') return 'Scan completed with warnings';
    if (snapshot.status === 'completed' || snapshot.status === 'resolved') return 'Scan complete';
    if (snapshot.status === 'queued') return 'Scan queued';
    return 'Security scan in progress';
  })();

  const subheading = (() => {
    if (pollError?.kind === 'auth') return 'Your session has expired — sign in again to view this scan.';
    if (pollError?.kind === 'not-found') return 'This scan does not exist or belongs to another account.';
    if (!scanId) return 'Start a new scan to see live progress here.';
    if (!snapshot) return 'Fetching the real lifecycle status from the server…';
    if (snapshot.status === 'queued' && !snapshot.worker_online) {
      return 'Your scan is queued. The background worker is starting automatically and will pick it up in a moment.';
    }
    return 'Real-time monitoring of the background security analysis.';
  })();

  // ── Empty state: no scan exists for this account ──────────────────────────
  if (!authLoading && !scanId) {
    return (
      <AppShell
        headerTitle="Scan progress"
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Scan progress' }]}
      >
        <div className="mx-auto max-w-[1400px] space-y-6">
          <PageHeader
            title={heading}
            description={subheading}
          />
          <EmptyState
            icon="Activity"
            title="No scan in progress"
            description="There is no scan in progress for your account. Scans only start when you create one."
            actionLabel="Start a new scan"
            actionIcon="Upload"
            onAction={() => navigate('/new-scan-setup')}
            secondaryAction={
              <Button
                className="mt-3"
                variant="outline"
                iconName="History"
                iconPosition="left"
                onClick={() => navigate('/scan-history')}
              >
                Scan history
              </Button>
            }
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      headerTitle="Scan progress"
      breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Scan progress' }]}
    >
      <div className="mx-auto max-w-[1400px] space-y-6">
        <PageHeader
          title={heading}
          description={subheading}
          actions={
            <>
              {snapshot ? (
                <StatusBadge
                  status={snapshot.status}
                  label={STATUS_LABELS[snapshot.status] || snapshot.status}
                />
              ) : null}
              {isTerminal && snapshot?.has_results ? (
                <Button
                  variant="default"
                  iconName="FileSearch"
                  iconPosition="left"
                  onClick={() => navigate('/scan-results', { state: { scanId } })}
                >
                  View results
                </Button>
              ) : null}
              <Button
                variant="outline"
                iconName="Plus"
                iconPosition="left"
                onClick={() => navigate('/new-scan-setup')}
              >
                New scan
              </Button>
            </>
          }
        />

        {/* ── Banners: auth, missing scan, connection, worker, failures ── */}
        {pollError?.kind === 'auth' ? (
          <Alert
            variant="error"
            title="Your session has expired"
            action={
              <Button variant="danger" size="sm" iconName="LogIn" iconPosition="left" onClick={() => navigate('/signin')}>
                Sign in
              </Button>
            }
          >
            Sign in again to continue watching this scan. The scan itself has not failed — its status
            is kept on the server.
          </Alert>
        ) : null}

        {pollError?.kind === 'not-found' ? (
          <Alert
            variant="warning"
            title="Scan not found"
            action={
              <Button variant="outline" size="sm" iconName="Trash2" iconPosition="left" onClick={handleScanNotFound}>
                Clear &amp; start new
              </Button>
            }
          >
            This scan does not exist, was removed, or belongs to another account.
          </Alert>
        ) : null}

        {pollError?.kind === 'network' ? (
          <Alert
            variant="warning"
            title="Connection lost"
            action={
              <Button variant="outline" size="sm" iconName="RefreshCw" iconPosition="left" onClick={handleRetryConnection}>
                Retry connection
              </Button>
            }
          >
            Could not reach the server{failedAttempts > 0 ? ` (${failedAttempts} failed attempts)` : ''}.
            {snapshot ? ' Showing the last known status.' : ''} The scan continues on the server.
          </Alert>
        ) : null}

        {snapshot && workerOffline && !pollError ? (
          <Alert
            variant="warning"
            title={snapshot.status === 'queued' ? 'Starting the scan worker' : 'The scan worker stopped responding'}
          >
            {snapshot.status === 'queued' ? (
              <>
                Your scan is safely queued and the background worker is being started automatically. It will
                pick the scan up within a few seconds — you can leave this page open.
              </>
            ) : (
              <>
                The worker running your scan has not reported in for a while. The scan continues on the
                server and is restarted automatically if the worker is really gone.
              </>
            )}
          </Alert>
        ) : null}

        {snapshot?.status === 'failed' ? (
          <Alert
            variant="error"
            title="The scan failed"
            action={
              <>
                <Button
                  variant="default"
                  size="sm"
                  iconName="RotateCw"
                  iconPosition="left"
                  onClick={handleRetryScan}
                  disabled={isRetryingScan}
                >
                  {isRetryingScan ? 'Retrying…' : 'Retry scan'}
                </Button>
                <Button variant="outline" size="sm" iconName="Plus" iconPosition="left" onClick={() => navigate('/new-scan-setup')}>
                  New scan
                </Button>
              </>
            }
          >
            <span className="break-words">{snapshot.error || 'The scan could not be completed.'}</span>
            {retryError ? <span className="mt-1 block text-error">{retryError}</span> : null}
          </Alert>
        ) : null}

        {snapshot?.status === 'completed_with_warnings' ? (
          <Alert
            variant="warning"
            title="Completed with warnings"
            action={
              <Button
                variant="default"
                size="sm"
                iconName="FileSearch"
                iconPosition="left"
                onClick={() => navigate('/scan-results', { state: { scanId } })}
                disabled={!snapshot.has_results}
              >
                View results
              </Button>
            }
          >
            <span className="break-words">
              {snapshot.error || 'Some scanners could not complete. Results are still available.'}
            </span>
          </Alert>
        ) : null}

        {!snapshot && !pollError ? (
          <LoadingRegion label="Loading scan status…">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <div className="rounded-xl border border-border bg-card p-4 md:p-5">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="mt-4 h-2 w-full rounded-full" />
                  <div className="mt-5 space-y-3">
                    {[0, 1, 2, 3].map((index) => (
                      <Skeleton key={index} className="h-16 w-full rounded-lg" />
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 md:p-5">
                  <Skeleton className="h-5 w-32" />
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                    {[0, 1, 2].map((index) => (
                      <Skeleton key={index} className="h-20 w-full rounded-lg" />
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-6">
                <div className="rounded-xl border border-border bg-card p-4 md:p-5">
                  <Skeleton className="h-5 w-36" />
                  <div className="mt-4 space-y-3">
                    {[0, 1, 2, 3, 4].map((index) => (
                      <Skeleton key={index} className="h-10 w-full" />
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 md:p-5">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="mt-4 h-10 w-full rounded-lg" />
                  <Skeleton className="mt-2 h-10 w-full rounded-lg" />
                </div>
              </div>
            </div>
          </LoadingRegion>
        ) : null}

        {snapshot ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <ProgressStageIndicator
                stages={stages}
                overallProgress={snapshot.progress ?? 0}
                statusLabel={STATUS_LABELS[snapshot.status] || snapshot.status}
              />

              <ScannerStatusPanel snapshot={snapshot} />

              <ScanLogs logs={logs} />
            </div>

            <div className="space-y-6">
              <ScanMetadata metadata={metadata} />

              <ScanActions
                snapshot={snapshot}
                isTerminal={isTerminal}
                isSuccessTerminal={isSuccessTerminal}
                onViewResults={() => navigate('/scan-results', { state: { scanId } })}
                onNewScan={() => navigate('/new-scan-setup')}
              />
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
};

export default ScanProgress;
