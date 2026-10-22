import React, { createContext, useState, useContext, useEffect } from 'react';
import {
  saveScanProgress,
  loadScanProgress,
  clearScanProgress,
  getCurrentUserId,
} from '../utils/persistenceUtils';

const ScanProgressContext = createContext();

export const useScanProgress = () => {
  const context = useContext(ScanProgressContext);
  if (!context) {
    throw new Error('useScanProgress must be used within ScanProgressProvider');
  }
  return context;
};

export const ScanProgressProvider = ({ children }) => {
  // Load persisted state scoped to the currently authenticated user on init.
  const [scanState, setScanState] = useState(() => loadScanProgress());
  const [isScanActive, setIsScanActive] = useState(scanState?.isActive || false);

  // Save state to localStorage whenever it changes (user-scoped key)
  useEffect(() => {
    if (isScanActive) {
      saveScanProgress(scanState);
    }
  }, [scanState, isScanActive]);

  const initiateScan = (initialData) => {
    const defaultStages = [
      {
        id: 'init',
        name: 'Initialization',
        description: 'Setting up scan environment and validating project structure',
        icon: 'Settings',
        progress: 100,
        filesProcessed: 0,
        rulesExecuted: 0,
        duration: '12s'
      },
      {
        id: 'analysis',
        name: 'File Analysis',
        description: 'Analyzing project files and detecting programming languages',
        icon: 'FileSearch',
        progress: 0,
        filesProcessed: 0,
        rulesExecuted: 0,
        duration: null
      },
      {
        id: 'dependencies',
        name: 'Dependency Resolution',
        description: 'Scanning package manifests and checking for known vulnerabilities',
        icon: 'Package',
        progress: 0,
        filesProcessed: 0,
        rulesExecuted: 0,
        duration: null
      },
      {
        id: 'static',
        name: 'Static Code Analysis',
        description: 'Running Semgrep rules to detect security vulnerabilities',
        icon: 'Code',
        progress: 0,
        filesProcessed: 0,
        rulesExecuted: 0,
        duration: null
      },
      {
        id: 'secrets',
        name: 'Secret Detection',
        description: 'Scanning for exposed credentials and sensitive information',
        icon: 'Key',
        progress: 0,
        filesProcessed: 0,
        rulesExecuted: 0,
        duration: null
      },
      {
        id: 'report',
        name: 'Report Generation',
        description: 'Compiling findings and generating comprehensive security report',
        icon: 'FileText',
        progress: 0,
        filesProcessed: 0,
        rulesExecuted: 0,
        duration: null
      }
    ];

    const newScanState = {
      isActive: true,
      id: initialData?.id || 'new_scan',
      projectName: initialData?.projectName || initialData?.name || initialData?.projectData?.filename || 'New Project',
      projectData: initialData?.projectData || initialData,
      stages: (initialData?.stages && initialData.stages.length > 0) ? initialData.stages : defaultStages,
      scanners: initialData?.scanners || [],
      currentStage: 0,
      overallProgress: 0,
      scanStartTime: new Date().toISOString(),
      findings: initialData?.findings || null,
      technicalDetails: initialData?.technicalDetails || null,
    };
    setScanState(newScanState);
    setIsScanActive(true);
    saveScanProgress(newScanState);

    // Keep user-scoped 'activeScan' key for compatibility with legacy parts of the app
    const userId = getCurrentUserId();
    const activeScanKey = userId ? `activeScan_${userId}` : 'activeScan';
    localStorage.setItem(activeScanKey, JSON.stringify({
      id: newScanState.id,
      timestamp: newScanState.scanStartTime,
      status: 'running',
      progress: 0,
      projectName: newScanState.projectName
    }));
  };

  const updateScanProgress = (updates) => {
    setScanState((prev) => {
      const newState = { ...prev, ...updates };

      // Keep the user-scoped 'activeScan' key in sync
      const userId = getCurrentUserId();
      const activeScanKey = userId ? `activeScan_${userId}` : 'activeScan';
      localStorage.setItem(activeScanKey, JSON.stringify({
        // Readers of this legacy key (scan-results, scan-progress) treat `id`
        // as the SCAN id — never the project id.
        id: (newState.id && newState.id !== 'new_scan') ? newState.id : 'new_scan',
        timestamp: newState.scanStartTime,
        status: newState.scanStatus
          || ((newState.overallProgress >= 100) ? 'completed' : 'running'),
        progress: Math.round(newState.overallProgress || 0),
        projectName: newState.projectName || newState.projectData?.projectName || newState.projectData?.name || newState.projectData?.filename || 'New Project'
      }));

      return newState;
    });
  };

  const updateStageProgress = (stageIndex, progress) => {
    setScanState((prev) => {
      const updatedStages = [...(prev.stages || [])];
      if (updatedStages[stageIndex]) {
        updatedStages[stageIndex] = { ...updatedStages[stageIndex], progress };
      }
      return { ...prev, stages: updatedStages };
    });
  };

  const updateScannerStatus = (scannerId, updates) => {
    setScanState((prev) => {
      const updatedScanners = [...(prev.scanners || [])];
      const scannerIndex = updatedScanners.findIndex((s) => s.id === scannerId);
      if (scannerIndex !== -1) {
        updatedScanners[scannerIndex] = { ...updatedScanners[scannerIndex], ...updates };
      }
      return { ...prev, scanners: updatedScanners };
    });
  };

  const completeScan = () => {
    setIsScanActive(false);
    // Functional update: always persists the LATEST state (the caller may
    // have just written progress from a status poll a moment earlier).
    setScanState((prev) => {
      const finalState = {
        ...prev,
        isActive: false,
        overallProgress: prev?.overallProgress ?? 100,
        scanEndTime: new Date().toISOString(),
      };
      saveScanProgress(finalState);
      return finalState;
    });
  };

  const resumeScan = () => {
    const persistedState = loadScanProgress();
    if (persistedState && persistedState.isActive) {
      setScanState(persistedState);
      setIsScanActive(true);
    }
  };

  const clearProgress = () => {
    setScanState({
      isActive: false,
      projectData: null,
      stages: [],
      scanners: [],
      currentStage: 0,
      overallProgress: 0,
    });
    setIsScanActive(false);
    clearScanProgress();
    // Also clear the user-scoped activeScan key
    const userId = getCurrentUserId();
    const activeScanKey = userId ? `activeScan_${userId}` : 'activeScan';
    localStorage.removeItem(activeScanKey);
  };

  const value = {
    scanState,
    isScanActive,
    initiateScan,
    updateScanProgress,
    updateStageProgress,
    updateScannerStatus,
    completeScan,
    resumeScan,
    clearProgress,
  };

  return (
    <ScanProgressContext.Provider value={value}>
      {children}
    </ScanProgressContext.Provider>
  );
};

export default ScanProgressContext;
