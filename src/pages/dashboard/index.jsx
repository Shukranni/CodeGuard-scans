/**
 * Dashboard — the security overview for the signed-in user.
 *
 * Every number on this page comes from the API:
 *   GET /api/scans/overview/?timeRange=24h|7d|30d|90d
 *   GET /api/scans/
 * Nothing is estimated or fabricated locally.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import PageHeader from '../../components/layout/PageHeader';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import { SkeletonCard, SkeletonList, Skeleton, LoadingRegion } from '../../components/ui/Skeleton';
import MetricsCard from './components/MetricsCard';
import RecentScanCard from './components/RecentScanCard';
import RiskDistributionChart from './components/RiskDistributionChart';
import TrendAnalysisChart from './components/TrendAnalysisChart';
import TopRiskyFileCard from './components/TopRiskyFileCard';
import ComplianceStatusCard from './components/ComplianceStatusCard';
import RecentAIExplanationCard from './components/RecentAIExplanationCard';
import ActiveScanProgress from './components/ActiveScanProgress';
import api from '../../utils/api';
import { cn } from '../../utils/cn';

const TIME_RANGES = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const TimeRangeControl = ({ value, onChange, disabled }) => (
  <div
    role="group"
    aria-label="Reporting period"
    className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
  >
    {TIME_RANGES.map((option) => {
      const isActive = option.value === value;
      return (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={isActive}
          disabled={disabled}
          className={cn(
            'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            'disabled:cursor-not-allowed disabled:opacity-60',
            isActive
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

const Dashboard = () => {
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState('7d');
  const [recentScans, setRecentScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasData, setHasData] = useState(false);

  const [metricsData, setMetricsData] = useState([]);
  const [riskDistribution, setRiskDistribution] = useState({
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  });
  const [trendData, setTrendData] = useState([]);
  const [topRiskyFiles, setTopRiskyFiles] = useState([]);
  const [complianceData, setComplianceData] = useState({
    standard: 'OWASP Top 10 2021',
    coverage: 0,
    status: 'partial',
    categories: [],
  });
  const [recentAIExplanations, setRecentAIExplanations] = useState([]);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Both endpoints are user-scoped on the Django side.
      const [overviewRes, scansRes] = await Promise.all([
        api.get(`/api/scans/overview/?timeRange=${timeRange}`),
        api.get('/api/scans/'),
      ]);

      if (overviewRes.data) {
        if (overviewRes.data.metrics) setMetricsData(overviewRes.data.metrics);
        if (overviewRes.data.riskDistribution) setRiskDistribution(overviewRes.data.riskDistribution);
        if (overviewRes.data.trendData) setTrendData(overviewRes.data.trendData);
        if (overviewRes.data.topRiskyFiles) setTopRiskyFiles(overviewRes.data.topRiskyFiles);
        if (overviewRes.data.complianceData) setComplianceData(overviewRes.data.complianceData);
        if (overviewRes.data.recentAIExplanations) {
          setRecentAIExplanations(overviewRes.data.recentAIExplanations);
        }
      }

      const mappedScans = (scansRes.data || []).map((scan) => {
        // The API derives the severity counts and the risk score from the
        // stored scanner output (see scans/services/findings.py). The card
        // shows them as they are — it never recomputes them locally.
        const summary = scan.summary || {};
        const counts = summary.findings || {};

        return {
          id: scan.id,
          projectName: scan.project_name || 'Unknown Project',
          timestamp: scan.started_at,
          scanType: 'Security Scan',
          riskScore: summary.riskScore ?? 0,
          findings: {
            critical: counts.critical ?? 0,
            high: counts.high ?? 0,
            medium: counts.medium ?? 0,
            low: counts.low ?? 0,
            total: counts.total ?? 0,
          },
          filesScanned:
            summary.fileCount ?? scan.result?.validation?.fileCount ?? scan.result?.fileCount ?? 0,
          status: scan.status,
        };
      });

      setRecentScans(mappedScans);
      // Determine whether this user has any scan data to show.
      setHasData(mappedScans.length > 0);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const handleResolveScan = async (scanId) => {
    try {
      await api.patch(`/api/scans/${scanId}/resolve/`);
      setRecentScans((prev) =>
        prev.map((scan) => (scan.id === scanId ? { ...scan, status: 'resolved' } : scan)),
      );
      fetchDashboardData();
    } catch (resolveError) {
      setError(resolveError);
    }
  };

  return (
    <AppShell headerTitle="Dashboard">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <PageHeader
          title="Security overview"
          description="Your scan history, risk distribution and compliance coverage in one place."
          actions={
            <>
              <TimeRangeControl
                value={timeRange}
                onChange={setTimeRange}
                disabled={loading}
              />
              <Button
                variant="outline"
                size="icon"
                iconName="RefreshCw"
                aria-label="Refresh dashboard data"
                onClick={fetchDashboardData}
                disabled={loading}
                className={loading ? '[&_svg]:animate-spin' : undefined}
              />
            </>
          }
        />

        <ActiveScanProgress />

        {loading ? (
          <LoadingRegion label="Loading dashboard data…">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <SkeletonCard key={index} />
              ))}
            </div>
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <div className="rounded-xl border border-border bg-card p-4 md:p-5">
                  <Skeleton className="h-5 w-40" />
                  <div className="mt-4">
                    <SkeletonList rows={3} />
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 md:p-5">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="mt-4 h-56 w-full" />
                </div>
              </div>
              <div className="space-y-6">
                <div className="rounded-xl border border-border bg-card p-4 md:p-5">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="mt-4 h-56 w-full" />
                </div>
                <div className="rounded-xl border border-border bg-card p-4 md:p-5">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="mt-4 h-24 w-full" />
                </div>
              </div>
            </div>
          </LoadingRegion>
        ) : error && !hasData ? (
          <ErrorState
            title="The dashboard could not be loaded"
            message={
              error?.response?.data?.detail ||
              error?.message ||
              'The server did not return the overview data.'
            }
            onRetry={fetchDashboardData}
          />
        ) : !hasData ? (
          <EmptyState
            icon="ShieldCheck"
            title="Welcome to CodeGuard"
            description="Upload a project and run your first scan to see vulnerabilities, risk scores and compliance coverage here."
            actionLabel="Upload and scan your first project"
            actionIcon="Upload"
            onAction={() => navigate('/new-scan-setup')}
          />
        ) : (
          <>
            {error ? (
              <ErrorState
                compact
                variant="warning"
                title="Some data could not be refreshed"
                message={error?.message || 'The last refresh did not complete.'}
                onRetry={fetchDashboardData}
                retryLabel="Retry"
              />
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metricsData.map((metric, index) => (
                <MetricsCard key={metric?.title || index} {...metric} />
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <section className="rounded-xl border border-border bg-card p-4 md:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-foreground">Recent scans</h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconName="ArrowRight"
                      iconPosition="right"
                      onClick={() => navigate('/scan-history')}
                    >
                      View all
                    </Button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {recentScans.length ? (
                      recentScans.slice(0, 3).map((scan) => (
                        <RecentScanCard
                          key={scan.id}
                          scan={scan}
                          onResolve={handleResolveScan}
                        />
                      ))
                    ) : (
                      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                        No scans yet.
                      </p>
                    )}
                  </div>
                </section>

                <section className="rounded-xl border border-border bg-card p-4 md:p-5">
                  <h2 className="text-base font-semibold text-foreground">Vulnerability trends</h2>
                  <div className="mt-4">
                    <TrendAnalysisChart data={trendData} />
                  </div>
                </section>
              </div>

              <div className="space-y-6">
                <section className="rounded-xl border border-border bg-card p-4 md:p-5">
                  <h2 className="text-base font-semibold text-foreground">Risk distribution</h2>
                  <div className="mt-4">
                    <RiskDistributionChart data={riskDistribution} />
                  </div>
                </section>

                <ComplianceStatusCard {...complianceData} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <section className="rounded-xl border border-border bg-card p-4 md:p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-foreground">Top risky files</h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconName="FolderTree"
                    iconPosition="right"
                    onClick={() => navigate('/file-tree-explorer')}
                  >
                    Explore
                  </Button>
                </div>
                <div className="mt-4 space-y-2.5">
                  {topRiskyFiles.length ? (
                    topRiskyFiles.map((file, index) => (
                      <TopRiskyFileCard key={file?.path || index} file={file} />
                    ))
                  ) : (
                    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                      No risky files yet.
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-card p-4 md:p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-foreground">
                    Recent AI explanations
                  </h2>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Icon name="Sparkles" size={16} aria-hidden="true" />
                  </span>
                </div>
                <div className="mt-4 space-y-2.5">
                  {recentAIExplanations.length ? (
                    recentAIExplanations.map((explanation, index) => (
                      <RecentAIExplanationCard
                        key={explanation?.finding_id || index}
                        explanation={explanation}
                      />
                    ))
                  ) : (
                    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                      No AI explanations yet. Open a finding in the results to generate one.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
};

export default Dashboard;
