import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
// import PrimaryNavigation from 'components/navigation/PrimaryNavigation';
import Header from 'components/navigation/Header';
import ProgressIndicator from '../../components/ui/ProgressIndicator';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import ScannerStatusCard from './components/ScannerStatusCard';
import ProjectDetailsCard from './components/ProjectDetailsCard';
import AdvancedDetailsPanel from './components/AdvancedDetailsPanel';
import CancelScanModal from './components/CancelScanModal';
import { useScanProgress } from '../../context/ScanProgressContext';

const ScanProgressTracking = () => {
  const navigate = useNavigate();
  const { scanState, updateScanProgress, updateScannerStatus, completeScan } = useScanProgress();
  const [overallProgress, setOverallProgress] = useState(scanState?.overallProgress || 0);
  const [estimatedTime, setEstimatedTime] = useState(180);
  const [currentOperation, setCurrentOperation] = useState('Initializing security scanners...');
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [scanStartTime] = useState(new Date('2025-12-10T16:45:00'));

  const [scanners, setScanners] = useState(() => {
    return scanState?.scanners || [
      {
        id: 'semgrep',
        name: 'Semgrep',
        icon: 'Shield',
        description: 'Static analysis for security vulnerabilities',
        status: 'running',
        progress: 45,
        currentFile: 'src/components/AuthHandler.jsx',
        logs: [
          'Analyzing authentication patterns...',
          'Checking for SQL injection vulnerabilities...',
          'Scanning for XSS patterns...'
        ],
        error: null
      },
      {
        id: 'gitleaks',
        name: 'GitLeaks',
        icon: 'Key',
        description: 'Secret and credential detection',
        status: 'running',
        progress: 67,
        currentFile: 'config/database.js',
        logs: [
          'Scanning for API keys...',
          'Checking environment files...',
          'Analyzing configuration files...'
        ],
        error: null
      },
      {
        id: 'osvdev',
        name: 'OSV.dev',
        icon: 'Package',
        description: 'Open source vulnerability database',
        status: 'pending',
        progress: 0,
        currentFile: null,
        logs: [
          'Waiting for dependency analysis...'
        ],
        error: null
      }
    ];
  });

  const projectDetails = {
    name: 'E-Commerce Platform',
    fileCount: 1247,
    size: 45678912,
    startTime: scanStartTime,
    source: 'github',
    sourceUrl: 'https://github.com/company/ecommerce-platform'
  };

  const technicalDetails = {
    cpuUsage: 78,
    memoryUsage: 2048,
    activeThreads: 8,
    filesScanned: 892,
    linesAnalyzed: 156789,
    rulesApplied: 342,
    scanMode: 'Comprehensive',
    parallelJobs: 4,
    timeout: 300,
    activityLog: [
      { timestamp: '16:47:23', message: 'Semgrep: Analyzing React components for security patterns' },
      { timestamp: '16:47:18', message: 'GitLeaks: Scanning commit history for exposed secrets' },
      { timestamp: '16:47:12', message: 'System: Allocated 2GB memory for scan operations' },
      { timestamp: '16:47:05', message: 'System: Initialized 4 parallel scanning threads' },
      { timestamp: '16:46:58', message: 'System: Loaded 342 security rules from database' },
      { timestamp: '16:46:45', message: 'System: Project extraction completed successfully' }
    ]
  };

  useEffect(() => {
    const progressInterval = setInterval(() => {
      setOverallProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          completeScan();
          setTimeout(() => {
            navigate('/vulnerability-dashboard');
          }, 1000);
          return 100;
        }
        return prev + 1;
      });

      setEstimatedTime((prev) => Math.max(0, prev - 2));

      setScanners((prevScanners) =>
        prevScanners?.map((scanner) => {
          if (scanner?.status === 'running' && scanner?.progress < 100) {
            const updatedScanner = {
              ...scanner,
              progress: Math.min(100, scanner?.progress + Math.random() * 3)
            };
            updateScannerStatus(scanner?.id, updatedScanner);
            return updatedScanner;
          }
          if (scanner?.status === 'pending' && overallProgress > 40) {
            const updatedScanner = {
              ...scanner,
              status: 'running',
              progress: 5
            };
            updateScannerStatus(scanner?.id, updatedScanner);
            return updatedScanner;
          }
          if (scanner?.progress >= 100 && scanner?.status === 'running') {
            const updatedScanner = {
              ...scanner,
              status: 'completed'
            };
            updateScannerStatus(scanner?.id, updatedScanner);
            return updatedScanner;
          }
          return scanner;
        })
      );

      const operations = [
        'Analyzing authentication patterns...',
        'Scanning for SQL injection vulnerabilities...',
        'Checking for XSS patterns...',
        'Detecting hardcoded credentials...',
        'Analyzing dependency vulnerabilities...',
        'Scanning configuration files...',
        'Checking for insecure cryptography...',
        'Analyzing API security patterns...'
      ];
      setCurrentOperation(operations?.[Math.floor(Math.random() * operations?.length)]);

      // Persist progress state
      updateScanProgress({
        overallProgress: overallProgress + 1,
        currentOperation,
      });
    }, 1000);

    return () => clearInterval(progressInterval);
  }, [navigate, overallProgress, updateScanProgress, updateScannerStatus, completeScan]);

  const handleCancelScan = () => {
    setIsCancelModalOpen(true);
  };

  const handleConfirmCancel = () => {
    setIsCanceling(true);
    setTimeout(() => {
      navigate('/upload-interface');
    }, 1500);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs?.toString()?.padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* <PrimaryNavigation /> */}
      <Header />
      <main className="main-content">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">Security Scan in Progress</h1>
              <p className="text-muted-foreground">
                Analyzing your project for vulnerabilities across multiple security scanners
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={handleCancelScan}
              iconName="XCircle"
              iconPosition="left"
              disabled={isCanceling}
            >
              Cancel Scan
            </Button>
          </div>

          <div className="bg-gradient-to-r from-primary/10 to-accent/10 rounded-lg border border-border p-8">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
                  <Icon name="Shield" size={32} color="var(--color-primary)" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-foreground">{Math.round(overallProgress)}%</h2>
                  <p className="text-sm text-muted-foreground">Overall Progress</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-foreground">{formatTime(estimatedTime)}</p>
                <p className="text-sm text-muted-foreground">Estimated Time Remaining</p>
              </div>
            </div>

            <ProgressIndicator
              value={overallProgress}
              max={100}
              variant={overallProgress === 100 ? 'success' : 'default'}
              showLabel={false}
              size="lg"
            />

            <div className="mt-4 flex items-center gap-2">
              <div className="animate-spin">
                <Icon name="Loader2" size={16} color="var(--color-primary)" />
              </div>
              <p className="text-sm text-foreground">{currentOperation}</p>
            </div>
          </div>

          <ProjectDetailsCard projectDetails={projectDetails} />

          <div>
            <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
              <Icon name="Activity" size={24} color="var(--color-primary)" />
              Scanner Status
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {scanners?.map((scanner) => (
                <ScannerStatusCard key={scanner?.id} scanner={scanner} />
              ))}
            </div>
          </div>

          <AdvancedDetailsPanel technicalDetails={technicalDetails} />

          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                <Icon name="Info" size={20} color="var(--color-accent)" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-foreground mb-2">What's happening?</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Your project is being analyzed by three industry-standard security scanners simultaneously. Each scanner specializes in different types of vulnerabilities to provide comprehensive coverage.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="flex items-start gap-2">
                    <Icon name="CheckCircle2" size={16} color="var(--color-success)" className="mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">Semgrep</p>
                      <p className="text-muted-foreground">Code patterns & logic flaws</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon name="CheckCircle2" size={16} color="var(--color-success)" className="mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">GitLeaks</p>
                      <p className="text-muted-foreground">Secrets & credentials</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Icon name="CheckCircle2" size={16} color="var(--color-success)" className="mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">OSV.dev</p>
                      <p className="text-muted-foreground">Known vulnerabilities</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <CancelScanModal
        isOpen={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
        onConfirm={handleConfirmCancel}
        isProcessing={isCanceling}
      />
    </div>
  );
};

export default ScanProgressTracking;
