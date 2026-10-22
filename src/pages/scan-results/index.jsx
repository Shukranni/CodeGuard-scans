/**
 * Scan Results — the findings of a finished scan.
 *
 * Data source
 *   GET /api/scans/<id>/  → { result: { validation, scans }, dismissed_findings, … }
 *
 * The severity mapping is the one the backend produces (semgrep ERROR →
 * critical, WARNING → high, otherwise medium; gitleaks → critical; dependency
 * critical/high/moderate → critical/high/medium, otherwise low). It is never
 * re-classified here.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useScanProgress } from '../../context/ScanProgressContext';
import { getCurrentUserId } from '../../utils/persistenceUtils';
import api from '../../utils/api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import AppShell from '../../components/layout/AppShell';
import PageHeader from '../../components/layout/PageHeader';
import AIExplanationOverlay from '../../components/navigation/AIExplanationOverlay';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Alert from '../../components/ui/Alert';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import { Skeleton, LoadingRegion } from '../../components/ui/Skeleton';

import RiskScoreCard from './components/RiskScoreCard';
import SeverityDistributionChart from './components/SeverityDistributionChart';
import FilterPanel from './components/FilterPanel';
import FindingRow from './components/FindingRow';
import ScanSummaryStats from './components/ScanSummaryStats';
import ExportMenu from './components/ExportMenu';
import TopRiskyFiles from './components/TopRiskyFiles';

const SEVERITY_WEIGHT = { critical: 40, high: 20, medium: 10, low: 5 };
const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * Build the per-file risk breakdown and the severity distribution for a set of
 * findings. Shared by the initial transform and by the dismiss/restore path so
 * both always agree.
 */
const summariseFindings = (findings) => {
  const distribution = { critical: 0, high: 0, medium: 0, low: 0 };
  const filesMap = {};

  findings.forEach((f) => {
    if (distribution[f.severity] !== undefined) distribution[f.severity] += 1;

    if (!filesMap[f.file]) {
      filesMap[f.file] = {
        path: f.file,
        vulnerabilities: 0,
        riskScore: 0,
        highestSeverity: 'low',
      };
    }

    filesMap[f.file].vulnerabilities += 1;
    filesMap[f.file].riskScore = Math.min(
      100,
      filesMap[f.file].riskScore + (SEVERITY_WEIGHT[f.severity] || 0),
    );

    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[filesMap[f.file].highestSeverity]) {
      filesMap[f.file].highestSeverity = f.severity;
    }
  });

  const topRiskyFiles = Object.values(filesMap)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 4);

  const score = Math.max(
    0,
    100 - (distribution.critical * 10 + distribution.high * 5 + distribution.medium * 2),
  );

  return { distribution, filesMap, topRiskyFiles, score };
};

const ScanResults = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isLoading: authLoading } = useAuth();
  const { scanState } = useScanProgress();
  const [scanData, setScanData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFinding, setSelectedFinding] = useState(null);
  const [showAIExplanation, setShowAIExplanation] = useState(false);
  const [sortBy, setSortBy] = useState('severity');
  const [sortOrder, setSortOrder] = useState('desc');
  const [filters, setFilters] = useState({
    severity: 'all',
    scanner: 'all',
    language: 'all',
    owaspCategories: [],
    showDismissed: false,
  });

  /**
   * Resolve the scan ID from (in priority order):
   *   1. Router location state — set by scan-history handleViewResults
   *   2. ScanProgressContext  — set immediately after a new scan starts
   *   3. User-scoped localStorage key — survives hard refresh for the
   *      authenticated user (written by ScanProgressContext.initiateScan)
   *   4. Legacy un-namespaced key   — fallback for older data
   */
  const resolvedScanId = (() => {
    if (location.state?.scanId) return location.state.scanId;
    if (scanState?.id && scanState.id !== 'new_scan') return scanState.id;
    const userId = getCurrentUserId();
    const userKey = userId ? `activeScan_${userId}` : null;
    if (userKey) {
      try {
        const stored = JSON.parse(localStorage.getItem(userKey));
        if (stored?.id && stored.id !== 'new_scan') return stored.id;
      } catch { /* ignore */ }
    }
    // Legacy fallback
    try {
      const legacy = JSON.parse(localStorage.getItem('activeScan'));
      if (legacy?.id && legacy.id !== 'new_scan') return legacy.id;
    } catch { /* ignore */ }
    return null;
  })();

  const transformScanData = (rawData) => {
    const scannersData = rawData?.result?.scans || {};
    const dismissedIds = rawData?.dismissed_findings || [];
    const findings = [];

    // Severity mapping — mirrors the backend classification exactly.
    const mapSeverity = (severity, scanner) => {
      const s = severity?.toLowerCase();
      if (scanner === 'semgrep') {
        if (s === 'error') return 'critical';
        if (s === 'warning') return 'high';
        return 'medium';
      }
      if (scanner === 'gitleaks') return 'critical';
      if (scanner === 'dependency') {
        if (s === 'critical') return 'critical';
        if (s === 'high') return 'high';
        if (s === 'moderate') return 'medium';
        return 'low';
      }
      return 'medium';
    };

    // 1. Semgrep findings
    if (scannersData?.semgrep?.all_vulnerabilities) {
      scannersData.semgrep.all_vulnerabilities.forEach((f, idx) => {
        findings.push({
          id: `semgrep_${idx}`,
          title: f.extra?.message?.split('.')?.[0] || 'Security issue detected',
          severity: mapSeverity(f.extra?.severity, 'semgrep'),
          confidence: 90,
          scanner: 'Semgrep',
          file: f.path,
          line: f.start?.line,
          language: f.path?.split('.')?.[f.path?.split('.')?.length - 1] || 'unknown',
          owasp: f.extra?.metadata?.owasp?.[0] || 'N/A',
          cwe: f.extra?.metadata?.cwe?.[0] || 'N/A',
          description: f.extra?.message || 'No description available',
          codeSnippet: f.extra?.lines || '',
          remediation: f.extra?.metadata?.remediation || f.extra?.message || 'Follow security best practices to remediate this issue.',
          fixCode: f.extra?.fix || null,
          isDismissed: dismissedIds.includes(`semgrep_${idx}`),
        });
      });
    }

    // 2. GitLeaks findings
    if (scannersData?.gitleaks?.all_vulnerabilities) {
      scannersData.gitleaks.all_vulnerabilities.forEach((f, idx) => {
        findings.push({
          id: `gitleaks_${idx}`,
          title: `Exposed Secret: ${f.Description || 'Credential'}`,
          severity: 'critical',
          confidence: 98,
          scanner: 'GitLeaks',
          file: f.File,
          line: f.StartLine,
          language: f.File?.split('.')?.[f.File?.split('.')?.length - 1] || 'unknown',
          owasp: 'A02:2021',
          cwe: 'CWE-798',
          description: `Hardcoded ${f.Description} detected in ${f.File}. These secrets should be moved to secure vaults or environment variables.`,
          codeSnippet: f.Match || '',
          remediation: 'Remove the hardcoded secret immediately. Revoke the credential and rotate it if it was previously pushed to a repository.',
          fixCode: '// Use environment variables or a secret manager instead\nconst apiKey = process.env.API_KEY;',
          isDismissed: dismissedIds.includes(`gitleaks_${idx}`),
        });
      });
    }

    // 3. Dependency (npm audit) findings
    if (scannersData?.dependency?.all_vulnerabilities) {
      Object?.entries(scannersData.dependency.all_vulnerabilities).forEach(([pkg, info]) => {
        findings.push({
          id: `dep_${pkg}`,
          title: `Vulnerable Dependency: ${pkg} ${info.range}`,
          severity: mapSeverity(info.severity, 'dependency'),
          confidence: 100,
          scanner: 'Dependency',
          file: 'package-lock.json',
          line: 0,
          language: 'npm',
          owasp: 'A06:2021',
          cwe: 'CWE-1104',
          description: `Package ${pkg} has security vulnerabilities. Summary: ${scannersData.dependency.summary || 'N/A'}`,
          codeSnippet: `"package": "${pkg}", "version": "${info.range}"`,
          remediation: `Update ${pkg} to the latest secure version by running the following command in your terminal.`,
          fixCode: `npm update ${pkg}`,
          isDismissed: dismissedIds.includes(`dep_${pkg}`),
        });
      });
    }

    const { distribution, filesMap, topRiskyFiles, score } = summariseFindings(findings);
    const validation = rawData?.result?.validation || {};

    return {
      scanId: rawData?.id,
      projectId: rawData?.project,
      projectName: rawData?.project_name || 'Secure Project',
      scanDate: rawData?.started_at,
      duration: rawData?.completed_at
        ? `${Math.round((new Date(rawData.completed_at) - new Date(rawData.started_at)) / 1000)}s`
        : 'N/A',
      overallRiskScore: score,
      riskTrend: 0,
      stats: {
        totalFindings: findings.length,
        critical: distribution.critical,
        high: distribution.high,
        medium: distribution.medium,
        low: distribution.low,
        filesAffected: Object.keys(filesMap).length,
        filesScanned: validation.fileCount ?? null,
        duration: rawData?.completed_at
          ? `${Math.round((new Date(rawData.completed_at) - new Date(rawData.started_at)) / 1000)}s`
          : 'N/A',
      },
      severityDistribution: distribution,
      topRiskyFiles,
      findings,
    };
  };

  const fetchScanResults = useCallback(async () => {
    if (!resolvedScanId) {
      setLoading(false);
      setError('No scan selected. Open a scan from your scan history or start a new scan.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await api.get(`/api/scans/${resolvedScanId}/`);
      setScanData(transformScanData(response.data));
    } catch (err) {
      console.error('Error fetching scan results:', err);
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        setError('Your session has expired. Please sign in again.');
      } else if (status === 404) {
        setError('Scan not found. It may have been deleted or belong to another account.');
      } else if (!err.response) {
        setError('Cannot reach the server. Please check your connection and try again.');
      } else {
        setError('Failed to load scan results. Please try again.');
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedScanId]);

  useEffect(() => {
    // Wait until auth initialisation has completed before touching protected
    // endpoints — prevents a 401 race condition on hard refresh.
    if (authLoading) return;
    fetchScanResults();
  }, [authLoading, fetchScanResults]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetFilters = () => {
    setFilters({
      severity: 'all',
      scanner: 'all',
      language: 'all',
      owaspCategories: [],
      showDismissed: false,
    });
    setSearchQuery('');
  };

  const handleViewDetails = (finding) => {
    setSelectedFinding(finding);
    setShowAIExplanation(true);
  };

  const handleDismissFinding = async (findingId) => {
    if (!scanData) return;

    const finding = scanData.findings.find((f) => f.id === findingId);
    if (!finding) return;

    const newDismissedState = !finding.isDismissed;
    const previousScanData = scanData;

    // Optimistic update — reverted below if the API call fails.
    const updatedFindings = scanData.findings.map((f) =>
      f.id === findingId ? { ...f, isDismissed: newDismissedState } : f,
    );

    const activeFindings = updatedFindings.filter((f) => !f.isDismissed);
    const { distribution, filesMap, topRiskyFiles, score } = summariseFindings(activeFindings);

    setScanData((prev) => ({
      ...prev,
      findings: updatedFindings,
      stats: {
        ...prev.stats,
        totalFindings: activeFindings.length,
        critical: distribution.critical,
        high: distribution.high,
        medium: distribution.medium,
        low: distribution.low,
        filesAffected: Object.keys(filesMap).length,
      },
      severityDistribution: distribution,
      overallRiskScore: score,
      topRiskyFiles,
    }));

    setActionError(null);

    // PERSISTENCE
    try {
      if (newDismissedState) {
        await api.post(`/api/scans/${scanData.scanId}/dismiss/`, { finding_id: findingId });
      } else {
        await api.delete(`/api/scans/${scanData.scanId}/dismiss/`, { data: { finding_id: findingId } });
      }
    } catch (err) {
      console.error('Failed to update finding dismissal status:', err);
      // The server is the source of truth — restore the previous state.
      setScanData(previousScanData);
      setActionError(
        err?.response?.data?.detail ||
          err?.response?.data?.error ||
          'The change could not be saved on the server, so the finding was restored.',
      );
    }
  };

  const handleExport = (format) => {
    if (!scanData) return;

    const exportData = {
      ...scanData,
      exportedAt: new Date().toISOString(),
      tool: 'CodeGuard',
    };

    let blob;
    let filename = `codeguard-report-${scanData.scanId || 'export'}-${new Date().getTime()}`;

    if (format === 'json') {
      blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      filename += '.json';
    } else if (format === 'csv') {
      const headers = ['ID', 'Title', 'Severity', 'Confidence', 'Scanner', 'File', 'Line', 'CWE', 'OWASP', 'Description'];
      const rows = scanData.findings.map((f) => [
        f.id,
        `"${String(f.title || '').replace(/"/g, '""')}"`,
        f.severity,
        f.confidence,
        f.scanner,
        f.file,
        f.line,
        f.cwe || 'N/A',
        f.owasp || 'N/A',
        `"${String(f.description || '').replace(/"/g, '""')}"`,
      ]);
      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      blob = new Blob([csvContent], { type: 'text/csv' });
      filename += '.csv';
    } else if (format === 'sarif') {
      // Basic SARIF structure
      const sarif = {
        $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json',
        version: '2.1.0',
        runs: [
          {
            tool: {
              driver: {
                name: 'CodeGuard',
                version: '1.0.0',
                rules: Array.from(new Set(scanData.findings.map((f) => f.scanner))).map((scanner) => ({
                  id: scanner,
                  name: `${scanner} Analysis`,
                })),
              },
            },
            results: scanData.findings.map((f) => ({
              ruleId: f.scanner,
              message: { text: f.title },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: f.file },
                    region: { startLine: f.line || 1 },
                  },
                },
              ],
              properties: {
                severity: f.severity,
                confidence: f.confidence,
                cwe: f.cwe,
                owasp: f.owasp,
              },
            })),
          },
        ],
      };
      blob = new Blob([JSON.stringify(sarif, null, 2)], { type: 'application/json' });
      filename += '.sarif';
    } else if (format === 'pdf') {
      const doc = new jsPDF();

      // Add Title
      doc.setFontSize(22);
      doc.setTextColor(30, 41, 59); // var(--color-foreground)
      doc.text('CodeGuard Security Report', 14, 22);

      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139); // var(--color-muted-foreground)
      doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);

      // Project Summary
      doc.setFontSize(14);
      doc.setTextColor(30, 41, 59);
      doc.text('Scan Summary', 14, 45);

      doc.setFontSize(10);
      doc.text(`Project Name: ${scanData.projectName}`, 14, 52);
      doc.text(`Scan ID: ${scanData.scanId}`, 14, 57);
      doc.text(`Total Findings: ${scanData.stats.totalFindings}`, 14, 62);
      doc.text(`Overall Risk Score: ${scanData.overallRiskScore}/100`, 14, 67);

      // Severity Table
      autoTable(doc, {
        startY: 75,
        head: [['Severity', 'Count']],
        body: [
          ['Critical', scanData.stats.critical],
          ['High', scanData.stats.high],
          ['Medium', scanData.stats.medium],
          ['Low', scanData.stats.low],
        ],
        theme: 'striped',
        headStyles: { fillStyle: '0F766E' },
        margin: { top: 10 },
      });

      // Findings Overview Table
      doc.setFontSize(14);
      doc.setTextColor(30, 41, 59);
      doc.text('Findings Overview', 14, doc.lastAutoTable.finalY + 15);

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 20,
        head: [['Severity', 'Scanner', 'File', 'Line', 'Title']],
        body: scanData.findings.map((f) => [
          f.severity.toUpperCase(),
          f.scanner,
          f.file,
          f.line,
          f.title,
        ]),
        styles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 20 },
          1: { cellWidth: 20 },
          2: { cellWidth: 40 },
          3: { cellWidth: 15 },
          4: { cellWidth: 'auto' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 0) {
            const severity = data.cell.raw.toLowerCase();
            if (severity === 'critical') data.cell.styles.textColor = [239, 68, 68];
            else if (severity === 'high') data.cell.styles.textColor = [245, 158, 11];
            else if (severity === 'medium') data.cell.styles.textColor = [59, 130, 246];
            else data.cell.styles.textColor = [16, 185, 129];
          }
        },
      });

      // Detailed Remediation Section
      doc.addPage();
      doc.setFontSize(18);
      doc.setTextColor(30, 41, 59);
      doc.text('Detailed Findings & Remediation', 14, 22);

      let currentY = 35;
      const severityColors = {
        critical: [239, 68, 68],
        high: [245, 158, 11],
        medium: [59, 130, 246],
        low: [16, 185, 129],
      };

      scanData.findings.forEach((f, index) => {
        // Approximate height calculation to handle page breaks
        const descriptionLines = doc.splitTextToSize(f.description || '', 180);
        const remediationLines = doc.splitTextToSize(f.remediation || '', 180);
        const codeHeight = (f.codeSnippet ? 20 : 0) + (f.fixCode ? 20 : 0);
        const estimatedHeight = 30 + descriptionLines.length * 5 + remediationLines.length * 5 + codeHeight;

        if (currentY + estimatedHeight > 280) {
          doc.addPage();
          currentY = 20;
        }

        // Finding Header
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(...(severityColors[f.severity.toLowerCase()] || [30, 41, 59]));
        doc.text(`${index + 1}. ${f.title}`, 14, currentY);
        currentY += 6;

        // Metadata
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text(
          `Severity: ${f.severity.toUpperCase()} | Scanner: ${f.scanner} | Location: ${f.file}:${f.line}`,
          14,
          currentY,
        );
        currentY += 8;

        // Description
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.setFont(undefined, 'bold');
        doc.text('Description:', 14, currentY);
        currentY += 5;
        doc.setFont(undefined, 'normal');
        doc.text(descriptionLines, 14, currentY);
        currentY += descriptionLines.length * 5 + 4;

        // Remediation
        doc.setFont(undefined, 'bold');
        doc.text('Remediation Guidance:', 14, currentY);
        currentY += 5;
        doc.setFont(undefined, 'normal');
        doc.text(remediationLines, 14, currentY);
        currentY += remediationLines.length * 5 + 6;

        // Code Snippets
        if (f.codeSnippet) {
          autoTable(doc, {
            startY: currentY,
            head: [['Vulnerable Code']],
            body: [[f.codeSnippet]],
            styles: { fontSize: 8, font: 'courier' },
            headStyles: { fillStyle: 'FEE2E2', textColor: [153, 27, 27] },
            margin: { left: 14, right: 14 },
          });
          currentY = doc.lastAutoTable.finalY + 6;
        }

        if (f.fixCode) {
          autoTable(doc, {
            startY: currentY,
            head: [['Suggested Fix']],
            body: [[f.fixCode]],
            styles: { fontSize: 8, font: 'courier' },
            headStyles: { fillStyle: 'DCFCE7', textColor: [22, 101, 52] },
            margin: { left: 14, right: 14 },
          });
          currentY = doc.lastAutoTable.finalY + 6;
        }

        currentY += 10; // Space between findings
      });

      doc.save(`${filename}.pdf`);
      return;
    } else {
      console.warn('Unsupported export format:', format);
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const filteredFindings = useMemo(() => {
    return (
      scanData?.findings?.filter((finding) => {
        if (filters?.severity !== 'all' && finding?.severity !== filters?.severity) return false;
        if (filters?.scanner !== 'all' && finding?.scanner?.toLowerCase() !== filters?.scanner) return false;
        if (filters?.language !== 'all' && finding?.language !== filters?.language) return false;
        if (
          filters?.owaspCategories?.length > 0 &&
          !filters?.owaspCategories?.some((cat) => finding?.owasp?.includes(cat?.split(':')?.[0]))
        ) {
          return false;
        }
        if (
          searchQuery &&
          !finding?.title?.toLowerCase()?.includes(searchQuery?.toLowerCase()) &&
          !finding?.file?.toLowerCase()?.includes(searchQuery?.toLowerCase())
        ) {
          return false;
        }

        // Dismissal logic
        if (!filters.showDismissed && finding.isDismissed) return false;
        if (filters.showDismissed && !finding.isDismissed) return false;

        return true;
      }) || []
    );
  }, [scanData?.findings, filters, searchQuery]);

  const sortedFindings = useMemo(() => {
    return [...filteredFindings].sort((a, b) => {
      if (sortBy === 'severity') {
        const comparison = (SEVERITY_RANK[b?.severity] || 0) - (SEVERITY_RANK[a?.severity] || 0);
        return sortOrder === 'asc' ? -comparison : comparison;
      }
      if (sortBy === 'confidence') {
        return sortOrder === 'asc' ? a?.confidence - b?.confidence : b?.confidence - a?.confidence;
      }
      return 0;
    });
  }, [filteredFindings, sortBy, sortOrder]);

  const allDismissed =
    !!scanData?.findings?.length && scanData.findings.every((f) => f.isDismissed);
  const hasFindings = !!scanData?.findings?.length;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading || authLoading) {
    return (
      <AppShell headerTitle="Scan results">
        <div className="mx-auto max-w-[1400px] space-y-6">
          <LoadingRegion label="Loading scan results…">
            <div className="space-y-6">
              <div className="rounded-xl border border-border bg-card p-4 md:p-5">
                <Skeleton className="h-6 w-56" />
                <Skeleton className="mt-3 h-4 w-72" />
              </div>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="rounded-xl border border-border bg-card p-4">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-3 h-7 w-16" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Skeleton className="h-44 w-full rounded-xl" />
                <Skeleton className="h-44 w-full rounded-xl lg:col-span-2" />
              </div>
              <div className="space-y-3">
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} className="h-20 w-full rounded-xl" />
                ))}
              </div>
            </div>
          </LoadingRegion>
        </div>
      </AppShell>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    const isAuthError = error.includes('session') || error.includes('sign in');
    const isNotFound = error.includes('not found') || error.includes('deleted');

    return (
      <AppShell headerTitle="Scan results">
        <div className="mx-auto max-w-[1400px] space-y-6">
          <PageHeader
            title="Scan results"
            description="The findings of a completed security scan."
          />
          <ErrorState
            title={isAuthError ? 'Session expired' : isNotFound ? 'Scan not found' : 'Results could not be loaded'}
            message={error}
            icon={isAuthError ? 'Lock' : isNotFound ? 'SearchX' : 'AlertTriangle'}
            onRetry={isAuthError || isNotFound ? undefined : fetchScanResults}
            retryLabel="Retry"
            action={
              isAuthError ? (
                <Button iconName="LogIn" iconPosition="left" onClick={() => navigate('/signin')}>
                  Sign in
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    iconName="History"
                    iconPosition="left"
                    onClick={() => navigate('/scan-history')}
                  >
                    Scan history
                  </Button>
                  <Button
                    iconName="LayoutDashboard"
                    iconPosition="left"
                    onClick={() => navigate('/dashboard')}
                  >
                    Back to dashboard
                  </Button>
                </>
              )
            }
          />
        </div>
      </AppShell>
    );
  }

  if (!scanData) return null;

  const openCodeExplorer = () => {
    if (scanData?.projectId && scanData?.scanId) {
      navigate(`/file-tree-explorer/${scanData.projectId}/${scanData.scanId}`);
    } else if (scanData?.projectId) {
      navigate(`/file-tree-explorer/${scanData.projectId}`);
    } else {
      navigate('/file-tree-explorer');
    }
  };

  return (
    <AppShell
      headerTitle="Scan results"
      breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Scan results' }]}
    >
      <div className="mx-auto max-w-[1400px] space-y-6">
        <PageHeader
          title="Scan results"
          description={scanData?.projectName}
          actions={
            <>
              <Button
                variant="outline"
                iconName="FolderTree"
                iconPosition="left"
                onClick={openCodeExplorer}
              >
                Code explorer
              </Button>
              <ExportMenu onExport={handleExport} />
              <Button
                variant="default"
                iconName="Plus"
                iconPosition="left"
                onClick={() => navigate('/new-scan-setup')}
              >
                New scan
              </Button>
            </>
          }
        >
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="Calendar" size={13} aria-hidden="true" />
              {new Date(scanData.scanDate)?.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="Hash" size={13} aria-hidden="true" />
              <span className="font-data">{scanData?.scanId}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="Timer" size={13} aria-hidden="true" />
              {scanData?.duration}
            </span>
          </div>
        </PageHeader>

        {actionError ? (
          <Alert variant="error" title="The change was not saved">
            {actionError}
          </Alert>
        ) : null}

        <ScanSummaryStats stats={scanData?.stats} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <RiskScoreCard
            score={scanData?.overallRiskScore}
            trend={scanData?.riskTrend}
            label="Overall risk score"
          />
          <div className="lg:col-span-2">
            <SeverityDistributionChart data={scanData?.severityDistribution} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <FilterPanel
              filters={filters}
              findings={scanData?.findings || []}
              onFilterChange={handleFilterChange}
              onReset={handleResetFilters}
              resultCount={filteredFindings?.length}
            />
          </div>
          <TopRiskyFiles files={scanData?.topRiskyFiles} />
        </div>

        <section className="rounded-xl border border-border bg-card">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">Vulnerability findings</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {sortedFindings.length} of {scanData.findings.length} finding
                {scanData.findings.length === 1 ? '' : 's'} shown
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="search"
                aria-label="Search findings by title or file"
                placeholder="Search by title or file…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e?.target?.value)}
                className="w-full sm:w-64"
              />
              <div className="flex gap-2" role="group" aria-label="Sort findings">
                <Button
                  variant={sortBy === 'severity' ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={sortBy === 'severity'}
                  onClick={() => handleSort('severity')}
                  iconName={sortBy === 'severity' && sortOrder === 'asc' ? 'ArrowUp' : 'ArrowDown'}
                  iconPosition="right"
                >
                  Severity
                </Button>
                <Button
                  variant={sortBy === 'confidence' ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={sortBy === 'confidence'}
                  onClick={() => handleSort('confidence')}
                  iconName={sortBy === 'confidence' && sortOrder === 'asc' ? 'ArrowUp' : 'ArrowDown'}
                  iconPosition="right"
                >
                  Confidence
                </Button>
              </div>
            </div>
          </div>

          <div className="p-4 md:p-5">
            {sortedFindings?.length === 0 ? (
              hasFindings ? (
                <EmptyState
                  compact
                  icon="Search"
                  title="No findings match your filters"
                  description="Try adjusting your search criteria or filters."
                  actionLabel="Reset filters"
                  actionIcon="RotateCcw"
                  onAction={handleResetFilters}
                />
              ) : allDismissed ? (
                <EmptyState
                  compact
                  icon="ShieldCheck"
                  title="All findings are dismissed"
                  description="Every finding in this scan has been dismissed. Switch on “Show dismissed” to review them again."
                />
              ) : (
                <EmptyState
                  compact
                  icon="ShieldCheck"
                  title="No vulnerabilities found"
                  description="The scanners completed without reporting any findings for this project."
                />
              )
            ) : (
              <ul className="space-y-3">
                {sortedFindings?.map((finding) => (
                  <li key={finding?.id}>
                    <FindingRow
                      finding={finding}
                      onViewDetails={handleViewDetails}
                      onDismiss={handleDismissFinding}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {showAIExplanation && selectedFinding ? (
        <AIExplanationOverlay
          scanId={scanData?.scanId}
          findingId={selectedFinding?.id}
          finding={selectedFinding}
          onExport={handleExport}
          onResolve={handleDismissFinding}
          onClose={() => {
            setShowAIExplanation(false);
            setSelectedFinding(null);
          }}
        />
      ) : null}
    </AppShell>
  );
};

export default ScanResults;
