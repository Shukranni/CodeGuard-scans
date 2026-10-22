import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
// import PrimaryNavigation from 'components/navigation/PrimaryNavigation';
import Header from 'components/navigation/Header';
import Icon from '../../components/AppIcon';
import Alert from '../../components/ui/Alert';
import FileUploadZone from './components/FileUploadZone';
import GitHubRepoInput from './components/GitHubRepoInput';
import RecentScansSection from './components/RecentScansSection';
import UploadMethodTabs from './components/UploadMethodTabs';
import ScanActionButtons from './components/ScanActionButtons';
import api from '../../utils/api';
import { useScanProgress } from '../../context/ScanProgressContext';

const DEFAULT_SCANNERS = ['semgrep', 'gitleaks', 'dependency'];

const UploadInterface = () => {
  const navigate = useNavigate();
  const { initiateScan } = useScanProgress();
  const [activeTab, setActiveTab] = useState('zip');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedProject, setUploadedProject] = useState(null);
  const [githubRepo, setGithubRepo] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Upload the ZIP archive to the server. The response is the created
   * project — the scan is started against its id.
   */
  const handleFileSelect = async (file) => {
    setSelectedFile(file);
    setUploadedProject(null);
    setError(null);

    if (!file) {
      setUploadProgress(0);
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await api.post('/api/projects/upload/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          if (progressEvent?.total) {
            setUploadProgress(
              Math.round((progressEvent.loaded * 100) / progressEvent.total),
            );
          }
        },
      });

      setUploadProgress(100);
      setUploadedProject(response?.data);
    } catch (uploadError) {
      setUploadProgress(0);
      setSelectedFile(null);
      setError(
        uploadError?.response?.data?.error ||
          uploadError?.message ||
          'The archive could not be uploaded. Please check your connection and try again.',
      );
    } finally {
      setIsUploading(false);
    }
  };

  /** The server already fetched and registered the repository. */
  const handleRepoSubmit = (project) => {
    setGithubRepo(project);
    setError(null);
  };

  const handleStartScan = async () => {
    if (isScanning) return;

    const projectId = activeTab === 'zip' ? uploadedProject?.id : githubRepo?.id;
    if (!projectId) {
      setError('Add a project before starting the scan.');
      return;
    }

    setIsScanning(true);
    setError(null);

    try {
      const response = await api.post('/api/scans/start/', {
        project_id: projectId,
        selected_scanners: DEFAULT_SCANNERS,
      });

      const scanId = response?.data?.id;
      if (!scanId) {
        throw new Error('The server did not return a scan id.');
      }

      initiateScan({
        id: scanId,
        status: response?.data?.status || 'queued',
        projectName: uploadedProject?.name || githubRepo?.name,
        scanners: DEFAULT_SCANNERS,
        projectData: {
          id: projectId,
          type: activeTab === 'zip' ? 'file' : 'github',
        },
      });

      navigate('/scan-progress', { state: { scanId } });
    } catch (scanError) {
      setIsScanning(false);
      setError(
        scanError?.response?.data?.error ||
          scanError?.message ||
          'The scan could not be started. Please try again.',
      );
    }
  };

  const handleClearAll = () => {
    setSelectedFile(null);
    setUploadedProject(null);
    setGithubRepo(null);
    setUploadProgress(0);
    setIsUploading(false);
    setError(null);
  };

  const handleViewHistory = () => {
    navigate('/scan-history');
  };

  const handleScanSelect = (scan) => {
    navigate('/scan-results', { state: { scanId: scan?.id } });
  };

  const canStartScan =
    activeTab === 'zip'
      ? Boolean(uploadedProject?.id) && !isUploading
      : Boolean(githubRepo?.id);

  return (
    <div className="min-h-screen bg-background">
      {/* <PrimaryNavigation /> */}
      <Header />

      <main className="main-content">
        <div className="max-w-7xl mx-auto px-4 py-8 sm:py-12">
          {/* Header Section */}
          <div className="text-center mb-8 sm:mb-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <Icon name="Shield" size={32} color="var(--color-primary)" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-3">
              Security Vulnerability Scanner
            </h1>
            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
              Upload your project or connect your GitHub repository to scan for security vulnerabilities with AI-powered remediation recommendations
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            {/* Main Upload Section */}
            <div className="lg:col-span-2 space-y-6">
              {/* Upload Method Tabs */}
              <UploadMethodTabs
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />

              {/* Upload Content */}
              <div className="bg-card rounded-lg border border-border p-6 sm:p-8">
                {activeTab === 'zip' ? (
                  <FileUploadZone
                    onFileSelect={handleFileSelect}
                    uploadProgress={uploadProgress}
                    isUploading={isUploading}
                  />
                ) : (
                  <GitHubRepoInput onRepoSubmit={handleRepoSubmit} />
                )}
              </div>

              {error ? (
                <Alert variant="error" title="Something went wrong" onDismiss={() => setError(null)}>
                  {error}
                </Alert>
              ) : null}

              {/* Action Buttons */}
              <ScanActionButtons
                canStartScan={canStartScan}
                isScanning={isScanning}
                onStartScan={handleStartScan}
                onClearAll={handleClearAll}
                onViewHistory={handleViewHistory}
              />

              {/* Features Info */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon name="Zap" size={16} color="var(--color-primary)" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">Fast Scanning</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Multiple security scanners run in parallel for quick results
                  </p>
                </div>

                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon name="Brain" size={16} color="var(--color-primary)" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">AI-Powered</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Get intelligent fix suggestions with detailed explanations
                  </p>
                </div>

                <div className="bg-card rounded-lg border border-border p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon name="FileText" size={16} color="var(--color-primary)" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">Detailed Reports</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Export comprehensive reports in PDF or JSON format
                  </p>
                </div>
              </div>
            </div>

            {/* Recent Scans Sidebar */}
            <div className="lg:col-span-1">
              <div className="bg-card rounded-lg border border-border p-6 sticky top-20">
                <RecentScansSection onScanSelect={handleScanSelect} />
              </div>
            </div>
          </div>

          {/* Security Scanners Info */}
          <div className="mt-12 bg-muted/30 rounded-lg border border-border p-6 sm:p-8">
            <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
              <Icon name="Shield" size={24} color="var(--color-primary)" />
              Integrated Security Scanners
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary"></div>
                  <h3 className="text-sm font-semibold text-foreground">Semgrep</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Static analysis for finding bugs and enforcing code standards across multiple languages
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary"></div>
                  <h3 className="text-sm font-semibold text-foreground">GitLeaks</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Detects hardcoded secrets like passwords, API keys, and tokens in your codebase
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary"></div>
                  <h3 className="text-sm font-semibold text-foreground">OSV.dev</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Identifies known vulnerabilities in open source dependencies and packages
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default UploadInterface;
