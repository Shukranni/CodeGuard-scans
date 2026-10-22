/**
 * Code Explorer — browse the scanned project and jump to its findings.
 *
 * Data sources
 *   GET /api/projects/                 → the project picker
 *   GET /api/projects/<id>/filetree/   → the file tree
 *   GET /api/projects/<id>/file/?path= → the content of one file
 *   GET /api/scans/<id>/               → the findings of the linked scan
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import AppShell from '../../components/layout/AppShell';
import PageHeader from '../../components/layout/PageHeader';
import AIExplanationOverlay from '../../components/navigation/AIExplanationOverlay';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Dropdown from '../../components/ui/Dropdown';
import EmptyState from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { cn } from '../../utils/cn';
import FileTreePanel from './components/FileTreePanel';
import CodePreviewPanel from './components/CodePreviewPanel';
import FindingDetailsPanel from './components/FindingDetailsPanel';

// ── Path normalisation (mirrors backend logic) ────────────────────────────────
const normalizePath = (p) => {
  if (!p) return '';
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
};

// ── Severity mapping from scan-results transform ──────────────────────────────
const mapSeverity = (severity, scanner) => {
  const s = (severity || '').toLowerCase();
  if (scanner === 'semgrep' || scanner === 'Semgrep') {
    if (s === 'error') return 'critical';
    if (s === 'warning') return 'high';
    return 'medium';
  }
  if (scanner === 'gitleaks' || scanner === 'GitLeaks') return 'critical';
  if (scanner === 'dependency' || scanner === 'Dependency') {
    if (s === 'critical') return 'critical';
    if (s === 'high') return 'high';
    if (s === 'moderate') return 'medium';
    return 'low';
  }
  const known = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', error: 'critical', warning: 'high' };
  return known[s] || 'medium';
};

// ── Extract normalised findings from raw scan result ─────────────────────────
const extractFindings = (scanResult) => {
  if (!scanResult) return [];
  const scannersData = scanResult?.result?.scans || {};
  const dismissedIds = scanResult?.dismissed_findings || [];
  const findings = [];

  // Semgrep
  if (scannersData?.semgrep?.all_vulnerabilities) {
    scannersData.semgrep.all_vulnerabilities.forEach((f, idx) => {
      findings.push({
        id: `semgrep_${idx}`,
        title: f.extra?.message?.split('.')?.[0] || 'Security issue detected',
        severity: mapSeverity(f.extra?.severity, 'semgrep'),
        scanner: 'Semgrep',
        file: normalizePath(f.path),
        line: f.start?.line,
        endLine: f.end?.line,
        description: f.extra?.message || 'No description available',
        codeSnippet: f.extra?.lines || '',
        remediation: f.extra?.metadata?.remediation || f.extra?.message || 'Follow security best practices.',
        cwe: f.extra?.metadata?.cwe?.[0] || null,
        owasp: f.extra?.metadata?.owasp?.[0] || null,
        ruleId: f.check_id || null,
        isDismissed: dismissedIds.includes(`semgrep_${idx}`),
      });
    });
  }

  // Gitleaks
  if (scannersData?.gitleaks?.all_vulnerabilities) {
    scannersData.gitleaks.all_vulnerabilities.forEach((f, idx) => {
      findings.push({
        id: `gitleaks_${idx}`,
        title: `Exposed Secret: ${f.Description || 'Credential'}`,
        severity: 'critical',
        scanner: 'GitLeaks',
        file: normalizePath(f.File),
        line: f.StartLine,
        endLine: f.EndLine,
        description: `Hardcoded ${f.Description} detected in ${f.File}.`,
        codeSnippet: f.Match || '',
        remediation: 'Remove the hardcoded secret immediately. Revoke and rotate the credential.',
        cwe: 'CWE-798',
        owasp: 'A02:2021',
        ruleId: f.RuleID || null,
        isDismissed: dismissedIds.includes(`gitleaks_${idx}`),
      });
    });
  }

  // Dependency / npm audit
  if (scannersData?.dependency?.all_vulnerabilities) {
    Object.entries(scannersData.dependency.all_vulnerabilities).forEach(([pkg, info]) => {
      findings.push({
        id: `dep_${pkg}`,
        title: `Vulnerable Dependency: ${pkg} ${info.range}`,
        severity: mapSeverity(info.severity, 'dependency'),
        scanner: 'Dependency',
        file: normalizePath('package-lock.json'),
        line: 0,
        description: `Package ${pkg} has known security vulnerabilities.`,
        codeSnippet: `"${pkg}": "${info.range}"`,
        remediation: `Update ${pkg} to the latest secure version: npm update ${pkg}`,
        cwe: 'CWE-1104',
        owasp: 'A06:2021',
        ruleId: null,
        isDismissed: dismissedIds.includes(`dep_${pkg}`),
      });
    });
  }

  return findings;
};

// ─────────────────────────────────────────────────────────────────────────────

const FileTreeExplorer = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId: routeProjectId, scanId: routeScanId } = useParams();
  const { isLoading: authLoading } = useAuth();

  // State
  const [projectId, setProjectId] = useState(routeProjectId || null);
  const [scanId, setScanId] = useState(routeScanId || null);
  const [projectName, setProjectName] = useState('');

  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState(null);

  const [findings, setFindings] = useState([]);
  const [findingsLoading, setFindingsLoading] = useState(false);

  const [selectedFinding, setSelectedFinding] = useState(null);
  const [showAIExplanation, setShowAIExplanation] = useState(false);
  const [showFindingPanel, setShowFindingPanel] = useState(false);

  const [viewMode, setViewMode] = useState('split'); // 'split' | 'full'
  const [projects, setProjects] = useState([]);

  // Navigate-to-line from location.state (when coming from scan-results finding click)
  const pendingNavigateRef = useRef(null);

  // ── Derive projectId/scanId from location state if not in route ─────────────
  useEffect(() => {
    if (location.state?.projectId && !routeProjectId) {
      setProjectId(location.state.projectId);
    }
    if (location.state?.scanId && !routeScanId) {
      setScanId(location.state.scanId);
    }
    if (location.state?.finding) {
      pendingNavigateRef.current = location.state.finding;
    }
  }, [location.state, routeProjectId, routeScanId]);

  // Sync route params into state
  useEffect(() => {
    if (routeProjectId) setProjectId(routeProjectId);
    if (routeScanId) setScanId(routeScanId);
  }, [routeProjectId, routeScanId]);

  // ── Fetch user's project list (for the project picker) ───────────────────────
  useEffect(() => {
    if (authLoading) return;
    api.get('/api/projects/')
      .then((r) => setProjects(r.data || []))
      .catch(() => {});
  }, [authLoading]);

  // ── Fetch file tree when projectId is known ─────────────────────────────────
  useEffect(() => {
    if (authLoading || !projectId) return;

    setFilesLoading(true);
    setFilesError(null);
    setFiles([]);
    setSelectedFile(null);
    setFileContent(null);

    api.get(`/api/projects/${projectId}/filetree/`)
      .then((r) => {
        setFiles(r.data.files || []);
        setProjectName(r.data.projectName || '');
      })
      .catch((err) => {
        const st = err.response?.status;
        if (st === 404) setFilesError('Project not found. It may have been deleted.');
        else if (st === 403 || st === 401) setFilesError('You do not have access to this project.');
        else setFilesError('Could not load the file tree. Please try again.');
      })
      .finally(() => setFilesLoading(false));
  }, [authLoading, projectId]);

  // ── Fetch scan findings when scanId is known ────────────────────────────────
  useEffect(() => {
    if (authLoading || !scanId) return;

    setFindingsLoading(true);
    api.get(`/api/scans/${scanId}/`)
      .then((r) => {
        const extracted = extractFindings(r.data);
        setFindings(extracted);
      })
      .catch(() => setFindings([]))
      .finally(() => setFindingsLoading(false));
  }, [authLoading, scanId]);

  // ── Load file content when a file is selected ───────────────────────────────
  const loadFileContent = useCallback(async (file) => {
    if (!file || file.isFolder || file.isBinary) return;

    setFileLoading(true);
    setFileError(null);
    setFileContent(null);

    try {
      const res = await api.get(`/api/projects/${projectId}/file/`, {
        params: { path: file.path },
      });
      setFileContent(res.data);
    } catch (err) {
      const st = err.response?.status;
      if (st === 422) {
        setFileError({ type: 'binary', message: err.response.data?.error || 'Binary file cannot be previewed.' });
      } else if (st === 404) {
        setFileError({ type: 'notfound', message: 'File not found in the project archive.' });
      } else {
        setFileError({ type: 'error', message: 'Failed to load file content.' });
      }
    } finally {
      setFileLoading(false);
    }
  }, [projectId]);

  const handleFileSelect = useCallback((file) => {
    if (file.isFolder) return;
    setSelectedFile(file);
    setSelectedFinding(null);
    loadFileContent(file);
  }, [loadFileContent]);

  const scrollToLine = useCallback((line) => {
    if (!line) return;
    const el = document.getElementById(`line-${line}`);
    if (!el) return;
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }, []);

  // ── Navigate to a finding from the finding details panel ────────────────────
  const handleFindingNavigate = useCallback((finding) => {
    setSelectedFinding(finding);
    setShowFindingPanel(true);

    if (!finding.file) return;

    const matchedFile = files.find(
      (f) => !f.isFolder && normalizePath(f.path) === normalizePath(finding.file),
    );

    if (matchedFile) {
      setSelectedFile(matchedFile);
      loadFileContent(matchedFile).then(() => {
        // Scroll to line after content loads
        if (finding.line) {
          setTimeout(() => scrollToLine(finding.line), 150);
        }
      });
    }
  }, [files, loadFileContent, scrollToLine]);

  // ── Handle pending navigation from location state ────────────────────────────
  useEffect(() => {
    const pending = pendingNavigateRef.current;
    if (!pending || files.length === 0) return;
    pendingNavigateRef.current = null;
    handleFindingNavigate(pending);
  }, [files, handleFindingNavigate]);

  // ── Handle jump to line after file loads ────────────────────────────────────
  useEffect(() => {
    if (fileContent && selectedFinding?.line) {
      const timer = setTimeout(() => scrollToLine(selectedFinding.line), 100);
      return () => clearTimeout(timer);
    }
  }, [fileContent, selectedFinding, scrollToLine]);

  // ── Project picker handler ───────────────────────────────────────────────────
  const handleProjectSelect = (pid) => {
    setScanId(null);
    setFindings([]);
    setSelectedFinding(null);
    setShowFindingPanel(false);
    navigate(`/file-tree-explorer/${pid}`);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  const projectMenuItems = [
    { type: 'label', label: 'Your projects' },
    ...(projects.length
      ? projects.map((p) => ({
          key: p.id,
          label: p.name,
          description: new Date(p.created_at).toLocaleDateString(),
          icon: 'Archive',
          onSelect: () => handleProjectSelect(p.id),
        }))
      : [{ type: 'label', label: 'No projects uploaded yet' }]),
    { type: 'separator' },
    {
      key: 'upload',
      label: 'Upload a new project',
      icon: 'Upload',
      onSelect: () => navigate('/new-scan-setup'),
    },
  ];

  const paneHeight = 'h-[32rem] lg:h-[calc(100vh-15rem)] lg:min-h-[26rem]';

  return (
    <AppShell
      headerTitle="Code explorer"
      breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Code explorer' }]}
    >
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
        <PageHeader
          title="Code explorer"
          description={
            projectName
              ? `${projectName}${scanId ? ' · findings are linked to the selected scan' : ''}`
              : 'Browse the files of an uploaded project and inspect the findings attached to them.'
          }
          actions={
            <>
              <Dropdown
                label="Choose a project"
                items={projectMenuItems}
                trigger={
                  <Button variant="outline" iconName="FolderOpen" iconPosition="left">
                    {projectId ? 'Switch project' : 'Open project'}
                  </Button>
                }
              />

              <div
                role="group"
                aria-label="View mode"
                className="hidden items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 lg:inline-flex"
              >
                {[
                  { value: 'split', label: 'Split', icon: 'Columns' },
                  { value: 'full', label: 'Code only', icon: 'Maximize' },
                ].map((option) => {
                  const isActive = viewMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setViewMode(option.value)}
                      aria-pressed={isActive}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon name={option.icon} size={13} aria-hidden="true" />
                      {option.label}
                    </button>
                  );
                })}
              </div>

              {findings.length > 0 ? (
                <Button
                  variant={showFindingPanel ? 'default' : 'outline'}
                  iconName="ShieldAlert"
                  iconPosition="left"
                  onClick={() => setShowFindingPanel((open) => !open)}
                  aria-expanded={showFindingPanel}
                >
                  {findings.length} {findings.length === 1 ? 'finding' : 'findings'}
                </Button>
              ) : null}

              {scanId ? (
                <Button
                  variant="outline"
                  iconName="FileSearch"
                  iconPosition="left"
                  onClick={() => navigate('/scan-results', { state: { scanId } })}
                >
                  All results
                </Button>
              ) : null}
            </>
          }
        />

        {/* No project selected */}
        {!projectId && !filesLoading ? (
          <EmptyState
            icon="FolderOpen"
            title="No project selected"
            description="Open a project to browse its files and the security findings attached to them."
            actionLabel="Upload a project"
            actionIcon="Upload"
            onAction={() => navigate('/new-scan-setup')}
          />
        ) : null}

        {/* Main layout */}
        {projectId ? (
          <div
            className={cn(
              'grid min-h-0 gap-4',
              viewMode === 'full'
                ? 'grid-cols-1'
                : 'lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(0,23rem)]',
            )}
          >
            {/* File tree panel */}
            <div className={cn('min-w-0', viewMode === 'full' && 'hidden')}>
              <FileTreePanel
                files={files}
                loading={filesLoading}
                error={filesError}
                selectedFile={selectedFile}
                onFileSelect={handleFileSelect}
                findings={findings}
                className={paneHeight}
              />
            </div>

            {/* Code viewer panel */}
            <div className={cn('min-w-0', viewMode !== 'full' && 'hidden lg:block')}>
              <CodePreviewPanel
                file={selectedFile}
                fileContent={fileContent}
                loading={fileLoading}
                error={fileError}
                findings={findings}
                selectedFinding={selectedFinding}
                onFindingClick={(finding) => {
                  setSelectedFinding(finding);
                  setShowFindingPanel(true);
                }}
                className={paneHeight}
              />
            </div>

            {/* Finding details panel — a drawer below 2xl, a column above */}
            {showFindingPanel && findings.length > 0 ? (
              <>
                <div
                  className="fixed inset-0 z-[900] bg-slate-950/50 backdrop-blur-sm 2xl:hidden"
                  onClick={() => setShowFindingPanel(false)}
                  aria-hidden="true"
                />
                <aside
                  aria-label="Findings"
                  className={cn(
                    'fixed inset-y-0 right-0 z-[950] w-full max-w-sm overflow-hidden border-l border-border bg-card shadow-2xl',
                    '2xl:static 2xl:z-auto 2xl:max-w-none 2xl:shadow-none',
                  )}
                >
                  <FindingDetailsPanel
                    finding={selectedFinding}
                    findings={findings}
                    onSelectFinding={handleFindingNavigate}
                    onClose={() => setShowFindingPanel(false)}
                    onViewAI={() => setShowAIExplanation(true)}
                    className={cn(paneHeight, 'lg:h-full 2xl:h-[calc(100vh-15rem)]')}
                  />
                </aside>
              </>
            ) : null}
          </div>
        ) : null}

        {authLoading || filesLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : null}
      </div>

      {/* AI Explanation overlay */}
      {showAIExplanation && selectedFinding ? (
        <AIExplanationOverlay
          scanId={scanId}
          findingId={selectedFinding?.id}
          finding={selectedFinding}
          onClose={() => setShowAIExplanation(false)}
        />
      ) : null}
    </AppShell>
  );
};

export default FileTreeExplorer;
