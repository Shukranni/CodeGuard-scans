import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import PageHeader from '../../components/layout/PageHeader';
import FilterToolbar from '../../components/ui/FilterToolbar';
import Select from '../../components/ui/Select';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import ScanHistoryCard from './components/ScanHistoryCard';
import SummaryDashboard from './components/SummaryDashboard';
import QuickAccessSection from './components/QuickAccessSection';
import BulkActionsBar from './components/BulkActionsBar';
import ComparisonModal from './components/ComparisonModal';
import api from '../../utils/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map a raw API scan object to the shape expected by ScanHistoryCard. */
const mapScan = (scan) => {
  const scansData = scan.result?.scans || {};
  let high = 0, medium = 0, low = 0;

  // Semgrep
  const semgrep = scansData.semgrep?.all_vulnerabilities || [];
  semgrep.forEach((v) => {
    const s = (v.extra?.severity || '').toLowerCase();
    if (s === 'error') high += 1;
    else if (s === 'warning') medium += 1;
    else low += 1;
  });

  // Gitleaks (always critical/high)
  const gitleaks = scansData.gitleaks?.all_vulnerabilities || [];
  high += gitleaks.length;

  // Dependency
  const deps = scansData.dependency?.all_vulnerabilities || {};
  if (typeof deps === 'object') {
    Object.values(deps).forEach((info) => {
      const s = (info?.severity || '').toLowerCase();
      if (s === 'critical' || s === 'high') high += 1;
      else if (s === 'moderate' || s === 'medium') medium += 1;
      else low += 1;
    });
  }

  return {
    id: scan.id,
    projectName: scan.project_name || 'Unknown Project',
    scanDate: scan.started_at,
    duration: scan.completed_at
      ? Math.round(
          (new Date(scan.completed_at) - new Date(scan.started_at)) / 1000
        )
      : null,
    filesProcessed: scan.result?.validation?.fileCount || scan.result?.fileCount || 0,
    status: scan.status
      ? scan.status.charAt(0).toUpperCase() + scan.status.slice(1)
      : 'Unknown',
    vulnerabilities: { high, medium, low },
    totalIssues: high + medium + low,
    criticalFiles: 0,
    projectSize: scan.result?.validation?.totalSize
      ? `${(scan.result.validation.totalSize / (1024 * 1024)).toFixed(1)} MB`
      : 'N/A',
    scannerVersions: (scan.scanners || []).map((name) => ({ name, version: '' })),
  };
};

/** Derive a summary object from the mapped scans array. */
const buildSummary = (scans) => {
  const totals = scans.reduce(
    (acc, s) => ({
      high: acc.high + (s.vulnerabilities?.high || 0),
      medium: acc.medium + (s.vulnerabilities?.medium || 0),
      low: acc.low + (s.vulnerabilities?.low || 0),
    }),
    { high: 0, medium: 0, low: 0 }
  );
  const projectNames = [...new Set(scans.map((s) => s.projectName))];
  return {
    totalScans: scans.length,
    scansThisMonth: scans.filter((s) => {
      const d = new Date(s.scanDate);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length,
    uniqueProjects: projectNames.length,
    activeProjects: projectNames.length,
    avgScanTime: 'N/A',
    scanTimeImprovement: '0%',
    totalIssuesFound: totals.high + totals.medium + totals.low,
    issuesTrend: '',
    totalVulnerabilities: totals,
    scanningFrequency: [],
  };
};

// ── Component ─────────────────────────────────────────────────────────────────

const ScanHistory = () => {
  const navigate = useNavigate();
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedScans, setSelectedScans] = useState([]);
  const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({});
  const [sortBy, setSortBy] = useState('date-desc');

  // ── Data fetching ────────────────────────────────────────────────────────────

  const fetchScans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/api/scans/');
      setScans(data.map(mapScan));
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
    const counts = {};
    scans.forEach((s) => {
      if (!counts[s.projectName]) {
        counts[s.projectName] = { id: s.id, name: s.projectName, scanCount: 0, lastScan: s.scanDate };
      }
      counts[s.projectName].scanCount += 1;
    });
    return Object.values(counts)
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
      if (searchQuery && !scan.projectName?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filters.severity && filters.severity !== 'all') {
        if (!scan.vulnerabilities?.[filters.severity]) return false;
      }
      if (filters.dateRange && filters.dateRange !== 'all') {
        const d = new Date(scan.scanDate);
        const now = new Date();
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
        case 'date-desc': return new Date(b.scanDate) - new Date(a.scanDate);
        case 'date-asc': return new Date(a.scanDate) - new Date(b.scanDate);
        case 'vulnerabilities-desc': return b.totalIssues - a.totalIssues;
        case 'vulnerabilities-asc': return a.totalIssues - b.totalIssues;
        default: return 0;
      }
    });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleSelectScan = (scanId, isSelected) => {
    setSelectedScans((prev) => isSelected ? [...prev, scanId] : prev.filter((id) => id !== scanId));
  };

  const handleSelectAll = () => {
    setSelectedScans(
      selectedScans.length === filteredAndSortedScans.length
        ? []
        : filteredAndSortedScans.map((s) => s.id)
    );
  };

  const handleViewResults = (scanId) => {
    navigate('/scan-results', { state: { scanId } });
  };

  const handleRerun = (scanId) => {
    const scan = scans.find((s) => s.id === scanId);
    navigate('/new-scan-setup', { state: { projectName: scan?.projectName } });
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
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download scan report:', err);
      window.alert('Failed to download the scan report. Please try again.');
    }
  };

  const handleDelete = (scanId) => {
    if (window.confirm('Are you sure you want to delete this scan?')) {
      setScans((prev) => prev.filter((s) => s.id !== scanId));
    }
  };

  const handleCompare = () => {
    if (selectedScans.length >= 2) setIsComparisonModalOpen(true);
  };

  const handleBulkExport = async () => {
    try {
      const results = await Promise.all(
        selectedScans.map((scanId) =>
          api.get(`/api/scans/${scanId}/`).then((r) => r.data).catch(() => null),
        ),
      );
      const filtered = results.filter(Boolean);
      const blob = new Blob([JSON.stringify(filtered, null, 2)], {
        type: 'application/json',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `codeguard-scans-bulk-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export selected scans:', err);
      window.alert('Failed to export selected scans. Please try again.');
    }
  };

  const handleBulkDelete = () => {
    if (window.confirm(`Delete ${selectedScans.length} scans?`)) {
      setScans((prev) => prev.filter((s) => !selectedScans.includes(s.id)));
      setSelectedScans([]);
    }
  };

  const handleStartNewScan = () => navigate('/new-scan-setup');

  const getComparisonScans = () =>
    scans.filter((s) => selectedScans.includes(s.id)).slice(0, 2);

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
          title="Scan history"
          description="Review and manage your security analysis sessions"
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
            <SummaryDashboard summaryData={summaryData} />

            <QuickAccessSection
              recentScans={scans.slice(0, 3)}
              frequentProjects={frequentProjects}
              onViewScan={handleViewResults}
              onStartNewScan={handleStartNewScan}
            />

            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                  <Icon name="History" size={24} />
                  All Scans ({filteredAndSortedScans.length})
                </h2>
                <div className="flex items-center gap-3">
                  <Select
                    options={dateRangeOptions}
                    value={filters.dateRange || 'all'}
                    onChange={(value) => setFilters({ ...filters, dateRange: value })}
                    placeholder="Date Range"
                  />
                  <Select
                    options={sortOptions}
                    value={sortBy}
                    onChange={setSortBy}
                    placeholder="Sort By"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                    iconName={selectedScans.length === filteredAndSortedScans.length ? 'CheckSquare' : 'Square'}
                    iconPosition="left"
                  >
                    {selectedScans.length === filteredAndSortedScans.length ? 'Deselect All' : 'Select All'}
                  </Button>
                </div>
              </div>

              <FilterToolbar
                onSearchChange={setSearchQuery}
                onFilterChange={setFilters}
                searchPlaceholder="Search by project name..."
                showExport={false}
              />

              <div className="space-y-4 mt-6">
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
                    <Icon name="Search" size={48} className="text-muted-foreground mx-auto mb-4" />
                    <p className="text-lg text-muted-foreground">No scans match your filters</p>
                    <p className="text-sm text-muted-foreground mt-2">
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
    </AppShell>
  );
};

export default ScanHistory;
