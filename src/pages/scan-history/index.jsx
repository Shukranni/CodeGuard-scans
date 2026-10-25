import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import PageHeader from '../../components/layout/PageHeader';
import Select from '../../components/ui/Select';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import Input from '../../components/ui/Input';
import ScanHistoryCard from './components/ScanHistoryCard';
import QuickAccessSection from './components/QuickAccessSection';
import BulkActionsBar from './components/BulkActionsBar';
import ComparisonModal from './components/ComparisonModal';
import SummaryDashboard from './components/SummaryDashboard';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import api from '../../utils/api';
import { useNotification } from '../../context/NotificationContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map a raw API scan object to the shape expected by ScanHistoryCard. */
const mapScan = (scan) => {
  const findings = scan.summary?.findings || {};
  const vulnerabilities = {
    critical: findings.critical || 0,
    high: findings.high || 0,
    medium: findings.medium || 0,
    low: (findings.low || 0) + (findings.info || 0),
  };
  const startedAt = new Date(scan.started_at);
  const completedAt = scan.completed_at ? new Date(scan.completed_at) : null;
  const duration = completedAt
    && Number.isFinite(startedAt.getTime())
    && Number.isFinite(completedAt.getTime())
    ? Math.max(0, Math.round((completedAt - startedAt) / 1000))
    : null;
  const rawStatus = (scan.status || 'unknown').replace(/_/g, ' ').toLowerCase();

  return {
    id: scan.id,
    projectId: scan.project,
    projectName: scan.project_name || 'Unknown Project',
    scanDate: scan.started_at,
    duration,
    filesProcessed: scan.summary?.fileCount ?? scan.result?.validation?.fileCount ?? 0,
    status: rawStatus.replace(/\b\w/g, (letter) => letter.toUpperCase()),
    statusKey: rawStatus,
    vulnerabilities,
    totalIssues: findings.total ?? Object.values(vulnerabilities).reduce((total, count) => total + count, 0),
    criticalFiles: null,
    projectSize: scan.result?.validation?.totalSize
      ? `${(scan.result.validation.totalSize / (1024 * 1024)).toFixed(1)} MB`
      : 'N/A',
    validation: scan.result?.validation || {},
    scannerVersions: (scan.scanners || []).map((name) => ({ name, version: '' })),
  };
};

/** Derive a summary object from the mapped scans array. */
const buildSummary = (scans) => {
  const totals = scans.reduce(
    (acc, s) => ({
      critical: acc.critical + (s.vulnerabilities?.critical || 0),
      high: acc.high + (s.vulnerabilities?.high || 0),
      medium: acc.medium + (s.vulnerabilities?.medium || 0),
      low: acc.low + (s.vulnerabilities?.low || 0),
    }),
    { critical: 0, high: 0, medium: 0, low: 0 }
  );
  const projects = new Set(scans.map((scan) => scan.projectId || scan.projectName));
  const monthAgo = Date.now() - 30 * 864e5;
  const timedScans = scans.filter((scan) => (
    Number.isFinite(scan.duration)
    && ['completed', 'completed with warnings'].includes(scan.statusKey)
  ));
  const durations = timedScans.map((scan) => scan.duration);
  const frequency = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return {
      day: date.toLocaleDateString('en-US', { weekday: 'short' }),
      scans: scans.filter((scan) => {
        const scanDate = new Date(scan.scanDate);
        return Number.isFinite(scanDate.getTime()) && scanDate.toDateString() === date.toDateString();
      }).length,
    };
  });
  return {
    totalScans: scans.length,
    scansThisMonth: scans.filter((s) => {
      const d = new Date(s.scanDate);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length,
    uniqueProjects: projects.size,
    activeProjects: new Set(scans
      .filter((scan) => new Date(scan.scanDate).getTime() >= monthAgo)
      .map((scan) => scan.projectId || scan.projectName)).size,
    avgScanTime: durations.length
      ? formatDuration(Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length))
      : 'N/A',
    totalIssuesFound: totals.critical + totals.high + totals.medium + totals.low,
    totalVulnerabilities: totals,
    scanningFrequency: frequency,
  };
};

const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds)) return 'N/A';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
};

// ── Component ─────────────────────────────────────────────────────────────────

const ScanHistory = () => {
  const navigate = useNavigate();
  const { success, error: notifyError } = useNotification();
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedScans, setSelectedScans] = useState([]);
  const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({ status: 'all', severity: 'all', dateRange: 'all' });
  const [sortBy, setSortBy] = useState('date-desc');

  // ── Data fetching ────────────────────────────────────────────────────────────

  const fetchScans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/api/scans/');
      const scanRows = Array.isArray(data) ? data : data?.results;
      if (!Array.isArray(scanRows)) {
        throw new Error('Scan history response was not a list.');
      }
      const mappedScans = scanRows.map(mapScan);
      setScans(mappedScans);
      setSelectedScans((prev) => prev.filter((id) => mappedScans.some((scan) => scan.id === id)));
    } catch (err) {
      console.error('Failed to fetch scan history:', err);
      setError('Could not load scan history. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScans();
  }, [fetchScans]);

  // ── Derived data ─────────────────────────────────────────────────────────────

  const summaryData = buildSummary(scans);

  /** Most-frequently scanned projects, for the QuickAccessSection */
  const frequentProjects = (() => {
    const counts = new Map();
    scans.forEach((s) => {
      const key = s.projectId || s.projectName;
      if (!counts.has(key)) {
        counts.set(key, {
          projectId: s.projectId,
          name: s.projectName,
          scanCount: 0,
          lastScan: s.scanDate,
          validation: s.validation,
        });
      }
      counts.get(key).scanCount += 1;
    });
    return [...counts.values()]
      .sort((a, b) => b.scanCount - a.scanCount)
      .slice(0, 3);
  })();

  // ── Sort options ─────────────────────────────────────────────────────────────

  const sortOptions = [
    { value: 'date-desc', label: 'Newest First' },
    { value: 'date-asc', label: 'Oldest First' },
    { value: 'vulnerabilities-desc', label: 'Most Vulnerabilities' },
    { value: 'vulnerabilities-asc', label: 'Least Vulnerabilities' },
  ];

  const dateRangeOptions = [
    { value: 'all', label: 'All Time' },
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'Last 7 Days' },
    { value: 'month', label: 'Last 30 Days' },
    { value: 'quarter', label: 'Last 3 Months' },
  ];

  // ── Filtering & sorting ──────────────────────────────────────────────────────

  const filteredAndSortedScans = scans
    .filter((scan) => {
      if (searchQuery && !scan.projectName?.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
      if (filters.status !== 'all' && scan.statusKey !== filters.status) return false;
      if (filters.severity !== 'all') {
        const { critical, high, medium, low } = scan.vulnerabilities;
        if (filters.severity === 'critical' && critical === 0) return false;
        if (filters.severity === 'high' && critical + high === 0) return false;
        if (filters.severity === 'medium' && critical + high + medium === 0) return false;
        if (filters.severity === 'low' && critical + high + medium + low === 0) return false;
      }
      if (filters.dateRange && filters.dateRange !== 'all') {
        const d = new Date(scan.scanDate);
        const now = new Date();
        if (!Number.isFinite(d.getTime()) || d > now) return false;
        if (filters.dateRange === 'today') {
          if (d.toDateString() !== now.toDateString()) return false;
        } else if (filters.dateRange === 'week') {
          if (now - d > 7 * 864e5) return false;
        } else if (filters.dateRange === 'month') {
          if (now - d > 30 * 864e5) return false;
        } else if (filters.dateRange === 'quarter') {
          if (now - d > 90 * 864e5) return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'date-desc': return new Date(b.scanDate).getTime() - new Date(a.scanDate).getTime();
        case 'date-asc': return new Date(a.scanDate).getTime() - new Date(b.scanDate).getTime();
        case 'vulnerabilities-desc': return b.totalIssues - a.totalIssues;
        case 'vulnerabilities-asc': return a.totalIssues - b.totalIssues;
        default: return 0;
      }
    });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleSelectScan = (scanId, isSelected) => {
    setSelectedScans((prev) => isSelected
      ? [...new Set([...prev, scanId])]
      : prev.filter((id) => id !== scanId));
  };

  const handleSelectAll = () => {
    const visibleIds = filteredAndSortedScans.map((scan) => scan.id);
    const allVisibleSelected = visibleIds.every((id) => selectedScans.includes(id));
    setSelectedScans((prev) => allVisibleSelected
      ? prev.filter((id) => !visibleIds.includes(id))
      : [...new Set([...prev, ...visibleIds])]);
  };

  const handleViewResults = (scanId) => {
    navigate('/scan-results', { state: { scanId } });
  };

  const handleRerun = (scanId) => {
    const scan = scans.find((s) => s.id === scanId);
    handleStartNewScan(scan?.projectId, scan?.projectName, scan?.validation);
  };

  const handleDownload = async (scanId) => {
    try {
      const { data } = await api.get(`/api/scans/${scanId}/`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const projectName = (data.project_name || 'scan').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      link.href = url;
      link.download = `codeguard-scan-${projectName}-${scanId}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      success('Report downloaded', 'The scan report was downloaded successfully.');
    } catch (err) {
      console.error('Failed to download scan report:', err);
      notifyError('Download failed', 'Failed to download the scan report. Please try again.');
    }
  };

  const handleDelete = (scanId) => {
    const scan = scans.find((s) => s.id === scanId);
    setConfirmState({
      type: 'single',
      scanId,
      title: `Delete scan "${scan?.projectName || scanId}"?`,
      description: 'This scan will be removed from your history and can no longer be viewed from this dashboard.',
      confirmLabel: 'Delete scan',
      variant: 'destructive',
    });
  };

  const handleCompare = () => {
    if (selectedScans.length === 2) setIsComparisonModalOpen(true);
  };

  const handleBulkExport = async () => {
    try {
      const results = await Promise.all(selectedScans.map((scanId) =>
        api.get(`/api/scans/${scanId}/`).then((response) => response.data),
      ));
      const blob = new Blob([JSON.stringify(results, null, 2)], {
        type: 'application/json',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `codeguard-scans-bulk-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      success('Bulk export complete', `Exported ${results.length} scan(s) successfully.`);
    } catch (err) {
      console.error('Failed to export selected scans:', err);
      notifyError('Export failed', 'Failed to export selected scans. Please try again.');
    }
  };

  const handleBulkDelete = () => {
    if (selectedScans.length === 0) return;
    setConfirmState({
      type: 'bulk',
      count: selectedScans.length,
      title: `Delete ${selectedScans.length} scan(s)?`,
      description: 'These scans will be permanently removed from your scan history.',
      confirmLabel: 'Delete scans',
      variant: 'destructive',
    });
  };

  const confirmDeleteAction = async () => {
    if (!confirmState) return;

    if (confirmState.type === 'single') {
      const scanId = confirmState.scanId;
      setConfirmState(null);
      try {
        await api.delete(`/api/scans/${scanId}/`);
        setScans((prev) => prev.filter((scan) => scan.id !== scanId));
        setSelectedScans((prev) => prev.filter((id) => id !== scanId));
        success('Scan deleted', 'The selected scan was deleted from history.');
      } catch (err) {
        console.error('Failed to delete scan:', err);
        if (err.response?.status === 409) {
          notifyError('Scan is still active', 'Wait for the scan to finish before deleting it.');
        } else {
          notifyError('Delete failed', 'Failed to delete the scan. Please try again.');
        }
      }
    } else {
      const scanIds = [...selectedScans];
      setConfirmState(null);
      const results = await Promise.allSettled(
        scanIds.map((scanId) => api.delete(`/api/scans/${scanId}/`)),
      );
      const deletedIds = scanIds.filter((_, index) => results[index].status === 'fulfilled');
      const failedCount = results.length - deletedIds.length;
      const activeCount = results.filter((result) =>
        result.status === 'rejected' && result.reason?.response?.status === 409,
      ).length;
      setScans((prev) => prev.filter((scan) => !deletedIds.includes(scan.id)));
      setSelectedScans((prev) => prev.filter((id) => !deletedIds.includes(id)));
      if (deletedIds.length) {
        success('Bulk deletion complete', `Deleted ${deletedIds.length} scan(s).`);
      }
      if (failedCount) {
        console.error('Failed to delete selected scans:', results.filter((result) => result.status === 'rejected'));
        const activeMessage = activeCount
          ? ` ${activeCount} active scan(s) must finish before deletion.`
          : '';
        notifyError(
          'Some scans could not be deleted',
          `${failedCount} scan(s) could not be deleted. They remain selected so you can retry.${activeMessage}`,
        );
      }
    }
  };

  const handleStartNewScan = (projectId, projectName, validation) => navigate(
    '/new-scan-setup',
    projectId ? { state: { projectId, projectName, validation } } : undefined,
  );

  const getComparisonScans = () => scans
    .filter((scan) => selectedScans.includes(scan.id))
    .slice(0, 2);

  // ── Empty state ──────────────────────────────────────────────────────────────

  const EmptyState = () => (
    <div className="text-center py-20 px-4">
      <div className="w-16 h-16 bg-muted/30 rounded-2xl flex items-center justify-center mx-auto mb-5">
        <Icon name="ScanLine" size={32} className="text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold text-foreground mb-2">No scans yet</h3>
      <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
        Upload a project and run your first security scan to see results here.
      </p>
      <Button variant="default" onClick={handleStartNewScan} iconName="Plus" iconPosition="left">
        Start Your First Scan
      </Button>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <AppShell
      headerTitle="Scan history"
      breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Scan history' }]}
    >
      <div className="mx-auto max-w-[1400px] space-y-6">
        <PageHeader
          title="Scan History"
          description="Review and manage your security scans."
          actions={
            <Button
              variant="default"
              onClick={handleStartNewScan}
              iconName="Plus"
              iconPosition="left"
            >
              New Scan
            </Button>
          }
        />

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <Icon name="Loader2" size={32} className="text-primary animate-spin" />
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="text-center py-16">
            <Icon name="AlertCircle" size={40} className="text-error mx-auto mb-3" />
            <p className="text-muted-foreground">{error}</p>
            <Button variant="outline" className="mt-4" onClick={fetchScans}>
              Retry
            </Button>
          </div>
        )}

        {/* Empty workspace */}
        {!loading && !error && scans.length === 0 && <EmptyState />}

        {/* Data */}
        {!loading && !error && scans.length > 0 && (
          <>
            <QuickAccessSection
              recentScans={scans.slice(0, 3)}
              frequentProjects={frequentProjects}
              onViewScan={handleViewResults}
              onStartNewScan={handleStartNewScan}
            />
            <SummaryDashboard summaryData={summaryData} />

            <div className="bg-card border border-border rounded-lg">
              <div className="flex flex-col gap-4 border-b border-border px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
                <div>
                  <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <Icon name="History" size={18} />
                    Scans ({filteredAndSortedScans.length})
                  </h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">Find and manage previous scans</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                    disabled={filteredAndSortedScans.length === 0}
                    iconName={filteredAndSortedScans.every((scan) => selectedScans.includes(scan.id)) ? 'CheckSquare' : 'Square'}
                    iconPosition="left"
                  >
                    {filteredAndSortedScans.length > 0 && filteredAndSortedScans.every((scan) => selectedScans.includes(scan.id)) ? 'Deselect All' : 'Select All'}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:flex-wrap md:items-center md:px-5">
                <div className="w-full md:w-64">
                  <Input
                    type="search"
                    placeholder="Search by project name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e?.target?.value)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    options={[
                      { value: 'all', label: 'All Status' },
                      { value: 'pending', label: 'Pending' },
                      { value: 'queued', label: 'Queued' },
                      { value: 'preparing', label: 'Preparing' },
                      { value: 'running', label: 'Running' },
                      { value: 'completed', label: 'Completed' },
                      { value: 'completed with warnings', label: 'Completed with warnings' },
                      { value: 'resolved', label: 'Resolved' },
                      { value: 'failed', label: 'Failed' },
                    ]}
                    value={filters.status || 'all'}
                    onChange={(value) => setFilters((prev) => ({ ...prev, status: value }))}
                    placeholder="Status"
                  />
                  <Select
                    options={[
                      { value: 'all', label: 'All Severities' },
                      { value: 'critical', label: 'Critical' },
                      { value: 'high', label: 'High+' },
                      { value: 'medium', label: 'Medium+' },
                      { value: 'low', label: 'Low+' },
                    ]}
                    value={filters.severity || 'all'}
                    onChange={(value) => setFilters((prev) => ({ ...prev, severity: value }))}
                    placeholder="Severity"
                  />
                  <Select
                    options={dateRangeOptions}
                    value={filters.dateRange || 'all'}
                    onChange={(value) => setFilters((prev) => ({ ...prev, dateRange: value }))}
                    placeholder="Date Range"
                  />
                  <Select
                    options={sortOptions}
                    value={sortBy}
                    onChange={setSortBy}
                    placeholder="Sort By"
                  />
                </div>
                {(searchQuery || (filters.status && filters.status !== 'all') || (filters.severity && filters.severity !== 'all') || (filters.dateRange && filters.dateRange !== 'all')) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchQuery('');
                      setFilters({ status: 'all', severity: 'all', dateRange: 'all' });
                    }}
                    iconName="X"
                    iconPosition="left"
                  >
                    Reset
                  </Button>
                )}
              </div>

              <div className="divide-y divide-border">
                {filteredAndSortedScans.length > 0 ? (
                  filteredAndSortedScans.map((scan) => (
                    <ScanHistoryCard
                      key={scan.id}
                      scan={scan}
                      onViewResults={handleViewResults}
                      onRerun={handleRerun}
                      onDownload={handleDownload}
                      onDelete={handleDelete}
                      onSelect={handleSelectScan}
                      isSelected={selectedScans.includes(scan.id)}
                    />
                  ))
                ) : (
                  <div className="text-center py-12">
                    <Icon name="Search" size={40} className="text-muted-foreground mx-auto mb-3" />
                    <p className="text-base text-foreground">No scans match your filters</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Try adjusting your search or filters
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <BulkActionsBar
        selectedCount={selectedScans.length}
        onCompare={handleCompare}
        onExport={handleBulkExport}
        onDelete={handleBulkDelete}
        onClearSelection={() => setSelectedScans([])}
      />
      <ComparisonModal
        isOpen={isComparisonModalOpen}
        onClose={() => setIsComparisonModalOpen(false)}
        scans={getComparisonScans()}
      />
      <ConfirmDialog
        isOpen={Boolean(confirmState)}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmDeleteAction}
        title={confirmState?.title || 'Are you sure?'}
        description={confirmState?.description}
        confirmLabel={confirmState?.confirmLabel || 'Confirm'}
        cancelLabel="Cancel"
        variant={confirmState?.variant || 'default'}
      />
    </AppShell>
  );
};

export default ScanHistory;
