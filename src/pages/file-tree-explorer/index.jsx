/**
 * Code Explorer — browse the scanned project and jump to its findings.
 *
 * Data sources
 *   GET /api/projects/                 → the project picker
 *   GET /api/projects/<id>/filetree/   → the file tree
 *   GET /api/projects/<id>/file/?path= → the content of one file
 *   GET /api/scans/<id>/               → the findings of the linked scan
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  return p
    .replace(/\\/g, '/')
    .replace(/^[A-Za-z]:\//, '')
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');
};

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

const sortFindings = (items) =>
  [...items].sort((a, b) => {
    const severityDifference =
      (SEVERITY_RANK[String(b.severity || '').toLowerCase()] || 0)
      - (SEVERITY_RANK[String(a.severity || '').toLowerCase()] || 0);
    if (severityDifference) return severityDifference;
    const lineA = Number.isInteger(Number(a.line)) && Number(a.line) > 0
      ? Number(a.line)
      : Number.POSITIVE_INFINITY;
    const lineB = Number.isInteger(Number(b.line)) && Number(b.line) > 0
      ? Number(b.line)
      : Number.POSITIVE_INFINITY;
    return lineA - lineB;
  });

const resolveFindingFile = (findingPath, files) => {
  const requestedPath = normalizePath(findingPath);
  if (!requestedPath) return null;

  const fileEntries = files.filter((file) => !file.isFolder);
  const exact = fileEntries.filter((file) => normalizePath(file.path) === requestedPath);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  // Scanner paths may omit (or include) a single ZIP root directory. Resolve
  // only a unique full-path suffix match; never fall back to basename alone.
  const suffixMatches = fileEntries.filter((file) => {
    const archivePath = normalizePath(file.path);
    return archivePath.endsWith(`/${requestedPath}`)
      || requestedPath.endsWith(`/${archivePath}`);
  });
  return suffixMatches.length === 1 ? suffixMatches[0] : null;
};

// ── Severity mapping from scan-results transform ──────────────────────────────
const mapSeverity = (severity, scanner) => {
  const s = (severity || '').toLowerCase();
  if (scanner === 'semgrep' || scanner === 'Semgrep') {
    if (s === 'error') return 'critical';
    if (s === 'warning') return 'high';
    if (s === 'info') return 'low';
    return 'medium';
  }
  if (scanner === 'gitleaks' || scanner === 'GitLeaks') return 'critical';
  if (scanner === 'dependency' || scanner === 'Dependency') {
    if (s === 'critical') return 'critical';
    if (s === 'high') return 'high';
    if (s === 'moderate') return 'medium';
    if (s === 'low') return 'low';
    return 'medium';
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
        scanId: scanResult.id,
        projectId: scanResult.project,
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
        scanId: scanResult.id,
        projectId: scanResult.project,
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
        scanId: scanResult.id,
        projectId: scanResult.project,
        title: `Vulnerable Dependency: ${pkg} ${info.range}`,
        severity: mapSeverity(info.severity, 'dependency'),
        scanner: 'Dependency',
        file: normalizePath('package-lock.json'),
        line: null,
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
  const projectId = routeProjectId || location.state?.projectId || null;
  const scanId = routeScanId || location.state?.scanId || null;

  // State
  const [projectName, setProjectName] = useState('');

  const [files, setFiles] = useState([]);
  const [filesProjectId, setFilesProjectId] = useState(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState(null);

  const [findings, setFindings] = useState([]);
  const [findingsScanId, setFindingsScanId] = useState(null);
  const [findingsProjectId, setFindingsProjectId] = useState(null);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [findingsError, setFindingsError] = useState(null);

  const [selectedFinding, setSelectedFinding] = useState(null);
  const [showAIExplanation, setShowAIExplanation] = useState(false);
  const [showFindingPanel, setShowFindingPanel] = useState(false);

  const [viewMode, setViewMode] = useState('split'); // 'split' | 'full'
  const [projects, setProjects] = useState([]);
  const [projectsError, setProjectsError] = useState(null);
  const [fileContentProjectId, setFileContentProjectId] = useState(null);
  const [findingNavigationError, setFindingNavigationError] = useState(null);

  // Navigate-to-line from location.state (when coming from scan-results finding click)
  const pendingNavigateRef = useRef(null);
  const pendingAutoSelectRef = useRef(null);
  const fileRequestRef = useRef(0);
  const visibleFiles = filesProjectId === projectId ? files : [];
  const visibleFindings =
    findingsScanId === scanId && (!projectId || findingsProjectId === projectId)
      ? findings
      : [];
  const visibleSelectedFile = filesProjectId === projectId ? selectedFile : null;
  const visibleFileContent =
    fileContentProjectId === projectId ? fileContent : null;
  const visibleProjectName = filesProjectId === projectId ? projectName : '';
  const visibleResolvedFindings = useMemo(
    () => visibleFindings.map((finding) => ({
      ...finding,
      resolvedPath: resolveFindingFile(finding.file, visibleFiles)?.path || null,
      scanId: finding.scanId || scanId,
      projectId: finding.projectId || findingsProjectId || projectId,
    })),
    [visibleFindings, visibleFiles, scanId, findingsProjectId, projectId],
  );
  const orderedResolvedFindings = useMemo(
    () => sortFindings(visibleResolvedFindings),
    [visibleResolvedFindings],
  );

  useEffect(() => {
    if (location.state?.finding) {
      pendingNavigateRef.current = location.state.finding;
    }
  }, [location.state]);

  // ── Fetch user's project list (for the project picker) ───────────────────────
  useEffect(() => {
    if (authLoading) return;
    let active = true;
    api.get('/api/projects/')
      .then((r) => {
        if (!active) return;
        setProjects(r.data || []);
        setProjectsError(null);
      })
      .catch(() => {
        if (!active) return;
        setProjectsError('Could not load your projects. Please try again.');
      });
    return () => {
      active = false;
    };
  }, [authLoading]);

  // ── Fetch file tree when projectId is known ─────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    let active = true;

    fileRequestRef.current += 1;
    setFilesProjectId(null);
    setSelectedFile(null);
    setFileContent(null);
    setFileContentProjectId(null);
    setFileError(null);
    setSelectedFinding(null);
    setFindingNavigationError(null);
    pendingAutoSelectRef.current = null;

    if (!projectId) {
      setFiles([]);
      setProjectName('');
      setFilesError(null);
      setFilesLoading(false);
      return () => {
        active = false;
      };
    }

    setFilesLoading(true);
    setFilesError(null);
    setFiles([]);

    api.get(`/api/projects/${projectId}/filetree/`)
      .then((r) => {
        if (!active) return;
        setFiles(r.data.files || []);
        setProjectName(r.data.projectName || '');
        setFilesProjectId(projectId);
      })
      .catch((err) => {
        if (!active) return;
        const st = err.response?.status;
        if (st === 404) {
          setFilesError(err.response.data?.error || 'Project not found. It may have been deleted.');
        }
        else if (st === 403 || st === 401) setFilesError('You do not have access to this project.');
        else setFilesError('Could not load the file tree. Please try again.');
      })
      .finally(() => {
        if (active) setFilesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, projectId]);

  // ── Fetch scan findings when scanId is known ────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    let active = true;
    setFindings([]);
    setFindingsScanId(null);
    setFindingsProjectId(null);
    setFindingsError(null);
    setSelectedFinding(null);
    setShowFindingPanel(false);
    setFindingNavigationError(null);
    pendingAutoSelectRef.current = null;

    if (!scanId) {
      setFindingsLoading(false);
      return () => {
        active = false;
      };
    }

    setFindingsLoading(true);
    api.get(`/api/scans/${scanId}/`)
      .then((r) => {
        if (!active) return;
        if (projectId && String(r.data.project) !== String(projectId)) {
          setFindingsError('This scan does not belong to the selected project.');
          return;
        }
        const extracted = extractFindings(r.data);
        setFindings(extracted);
        setFindingsScanId(scanId);
        setFindingsProjectId(String(r.data.project));
      })
      .catch(() => {
        if (active) setFindingsError('Could not load findings for this scan.');
      })
      .finally(() => {
        if (active) setFindingsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, projectId, scanId]);

  // ── Load file content when a file is selected ───────────────────────────────
  const loadFileContent = useCallback(async (file) => {
    if (!file || file.isFolder) return;
    const requestId = ++fileRequestRef.current;
    const requestedProjectId = projectId;

    setFileLoading(true);
    setFileError(null);
    setFileContent(null);
    setFileContentProjectId(null);

    if (file.isBinary) {
      setFileError({ type: 'binary', message: 'Binary files cannot be previewed.' });
      setFileLoading(false);
      return;
    }

    try {
      const res = await api.get(`/api/projects/${requestedProjectId}/file/`, {
        params: { path: file.path },
      });
      if (requestId !== fileRequestRef.current) return;
      setFileContent(res.data);
      setFileContentProjectId(requestedProjectId);
    } catch (err) {
      if (requestId !== fileRequestRef.current) return;
      const st = err.response?.status;
      if (st === 422) {
        setFileError({ type: 'binary', message: err.response.data?.error || 'Binary file cannot be previewed.' });
      } else if (st === 404) {
        setFileError({ type: 'notfound', message: err.response.data?.error || 'File not found in the project archive.' });
      } else {
        setFileError({ type: 'error', message: 'Failed to load file content.' });
      }
    } finally {
      if (requestId === fileRequestRef.current) setFileLoading(false);
    }
  }, [projectId]);

  const handleFileSelect = useCallback((file) => {
    if (file.isFolder) return;
    const fileFindings = sortFindings(
      visibleResolvedFindings.filter(
        (finding) => finding.resolvedPath && normalizePath(finding.resolvedPath) === normalizePath(file.path),
      ),
    );
    pendingAutoSelectRef.current = { filePath: normalizePath(file.path), scanId };
    setSelectedFile(file);
    setSelectedFinding(fileFindings[0] || null);
    setShowFindingPanel(false);
    setFindingNavigationError(null);
    loadFileContent(file);
  }, [visibleResolvedFindings, scanId, loadFileContent]);

  // ── Navigate to a finding from the finding details panel ────────────────────
  const handleFindingNavigate = useCallback((finding) => {
    pendingAutoSelectRef.current = null;
    setShowFindingPanel(false);
    setSelectedFinding({
      ...finding,
      resolvedPath: resolveFindingFile(finding.file, visibleFiles)?.path || null,
      scanId: finding.scanId || scanId,
      projectId: finding.projectId || projectId,
    });

    if (finding.scanId && scanId && String(finding.scanId) !== String(scanId)) {
      fileRequestRef.current += 1;
      setSelectedFile(null);
      setFileContent(null);
      setFileLoading(false);
      setFileError(null);
      setFindingNavigationError('This finding belongs to a different scan than the one currently selected.');
      return;
    }

    const matchedFile = resolveFindingFile(finding.file, visibleFiles);
    if (!matchedFile) {
      fileRequestRef.current += 1;
      setSelectedFile(null);
      setFileContent(null);
      setFileLoading(false);
      setFileError(null);
      setFindingNavigationError(
        finding.file
          ? `Could not resolve "${finding.file}" to one unique file in this project's archive.`
          : 'This finding does not include a source file path.',
      );
      return;
    }

    setFindingNavigationError(null);
    setSelectedFile(matchedFile);
    loadFileContent(matchedFile);
  }, [visibleFiles, scanId, projectId, loadFileContent]);

  const handleInlineFindingSelect = useCallback((finding) => {
    setSelectedFinding(finding);
    setShowFindingPanel(true);
    setFindingNavigationError(null);
  }, []);

  // ── Handle pending navigation from location state ────────────────────────────
  useEffect(() => {
    const pending = pendingNavigateRef.current;
    if (!pending || filesLoading || !projectId || filesProjectId !== projectId) return;
    pendingNavigateRef.current = null;
    handleFindingNavigate(pending);
  }, [visibleFiles, filesLoading, filesProjectId, projectId, handleFindingNavigate]);

  // Pick a valid scanner-reported line only after the selected file is loaded.
  useEffect(() => {
    const pending = pendingAutoSelectRef.current;
    if (
      !pending
      || !visibleFileContent
      || !visibleSelectedFile
      || pending.scanId !== scanId
      || (scanId && findingsScanId !== scanId)
      || pending.filePath !== normalizePath(visibleSelectedFile.path)
      || normalizePath(visibleFileContent.path) !== normalizePath(visibleSelectedFile.path)
    ) return;

    pendingAutoSelectRef.current = null;
    const lineCount = String(visibleFileContent.content || '').split('\n').length;
    const fileFindings = sortFindings(
      visibleResolvedFindings.filter(
        (finding) => finding.resolvedPath
          && normalizePath(finding.resolvedPath) === normalizePath(visibleSelectedFile.path),
      ),
    );
    const firstValid = fileFindings.find((finding) => {
      const line = Number(finding.line);
      return Number.isInteger(line) && line > 0 && line <= lineCount;
    });
    setSelectedFinding(firstValid || fileFindings[0] || null);
    setShowFindingPanel(false);
  }, [visibleFileContent, visibleSelectedFile, visibleResolvedFindings, findingsScanId, scanId]);

  // ── Project picker handler ───────────────────────────────────────────────────
  const handleProjectSelect = (pid) => {
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
      : [{ type: 'label', label: projectsError || 'No projects uploaded yet' }]),
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
            visibleProjectName
              ? `${visibleProjectName}${scanId ? ' · findings are linked to the selected scan' : ''}`
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

              {visibleFindings.length > 0 ? (
                <Button
                  variant={showFindingPanel ? 'default' : 'outline'}
                  iconName="ShieldAlert"
                  iconPosition="left"
                  onClick={() => setShowFindingPanel((open) => !open)}
                  aria-expanded={showFindingPanel}
                >
                  {visibleFindings.length} {visibleFindings.length === 1 ? 'finding' : 'findings'}
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

        {findingsError ? (
          <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
            {findingsError}
          </p>
        ) : null}
        {findingNavigationError ? (
          <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
            {findingNavigationError}
          </p>
        ) : null}

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
                files={visibleFiles}
                loading={filesLoading}
                error={filesError}
                selectedFile={visibleSelectedFile}
                onFileSelect={handleFileSelect}
                findings={orderedResolvedFindings}
                revealFilePath={visibleSelectedFile?.path}
                className={paneHeight}
              />
            </div>

            {/* Code viewer panel */}
            <div className={cn('min-w-0', viewMode !== 'full' && 'hidden lg:block')}>
              <CodePreviewPanel
                file={visibleSelectedFile}
                fileContent={visibleFileContent}
                loading={fileLoading}
                error={fileError}
                findings={orderedResolvedFindings}
                selectedFinding={selectedFinding}
                onFindingClick={handleInlineFindingSelect}
                className={paneHeight}
              />
            </div>

            {/* Finding details panel — a drawer below 2xl, a column above */}
            {showFindingPanel && (visibleFindings.length > 0 || selectedFinding) ? (
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
                    findings={
                      visibleFindings.some((finding) => finding.id === selectedFinding?.id)
                        ? visibleFindings
                        : [...visibleFindings, selectedFinding].filter(Boolean)
                    }
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
