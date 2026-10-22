# Persistent Scan Progress Documentation

## Overview

The CodeGuard application now supports persistent scan progress tracking. This means that scan state is automatically saved to the browser's localStorage and can be restored if the user navigates away or refreshes the page.

## Architecture

### Components

#### 1. **ScanProgressContext** (`src/context/ScanProgressContext.jsx`)
- Global state management for scan progress
- Automatically loads persisted state on initialization
- Provides methods to manage scan lifecycle

**Provided Functions:**
- `initiateScan(projectData)` - Start a new scan
- `updateScanProgress(updates)` - Update overall scan state
- `updateStageProgress(stageIndex, progress)` - Update specific stage progress
- `updateScannerStatus(scannerId, updates)` - Update individual scanner status
- `completeScan()` - Mark scan as complete
- `resumeScan()` - Resume a previously saved scan
- `clearProgress()` - Clear all saved progress

#### 2. **Persistence Utilities** (`src/utils/persistenceUtils.js`)
- Handles localStorage operations
- Manages data serialization/deserialization
- Implements automatic expiry (24 hours)

**Available Functions:**
- `saveScanProgress(scanState)` - Save scan state to localStorage
- `loadScanProgress()` - Load scan state from localStorage
- `clearScanProgress()` - Remove all saved scan data
- `hasActiveScan()` - Check if an active scan exists
- `getLastScanUpdate()` - Get timestamp of last update
- `exportScanProgress()` - Export scan data for download
- `importScanProgress(scanData)` - Import scan data

## Usage

### Setting Up the Provider

Wrap your application with `ScanProgressProvider` in the root component:

```jsx
import { ScanProgressProvider } from './context/ScanProgressContext';

function App() {
  return (
    <ScanProgressProvider>
      {/* Your routes and components */}
    </ScanProgressProvider>
  );
}
```

### Using the Hook in Components

```jsx
import { useScanProgress } from '../context/ScanProgressContext';

function MyComponent() {
  const { scanState, initiateScan, updateScanProgress } = useScanProgress();

  const handleStartScan = () => {
    initiateScan({
      projectData: {
        type: 'file',
        filename: 'project.zip'
      }
    });
  };

  return (
    <div>
      <p>Progress: {scanState.overallProgress}%</p>
      <button onClick={handleStartScan}>Start Scan</button>
    </div>
  );
}
```

## Data Structure

### Scan State
```javascript
{
  isActive: boolean,
  projectData: {
    type: 'file' | 'github',
    // type-specific fields...
  },
  stages: Array<Stage>,
  scanners: Array<Scanner>,
  currentStage: number,
  overallProgress: number,
  scanStartTime: string (ISO),
  scanEndTime?: string (ISO),
  findings: Object,
  technicalDetails: Object,
  lastUpdated: string (ISO)
}
```

### Stage Structure
```javascript
{
  id: string,
  name: string,
  description: string,
  icon: string,
  progress: number (0-100),
  filesProcessed: number,
  rulesExecuted: number,
  duration?: string
}
```

### Scanner Structure
```javascript
{
  id: string,
  name: string,
  icon: string,
  description: string,
  status: 'pending' | 'running' | 'completed' | 'error',
  progress: number (0-100),
  currentFile?: string,
  logs: Array<string>,
  error?: string
}
```

## Features

### Automatic Persistence
- State is automatically saved to localStorage whenever it changes
- Updates occur only when a scan is active (`isScanActive = true`)

### Data Expiry
- Saved data automatically expires after 24 hours
- Expired data is cleared on the next load attempt
- Can be configured via `STORAGE_EXPIRY_TIME` constant

### Automatic Restoration
- When the app loads, it automatically checks for saved scan progress
- If active scan is found, it's restored to the previous state
- User can choose to resume or start fresh

### Memory Efficient
- Only essential data is stored
- Data is compressed via JSON stringification
- Expiry management prevents infinite data accumulation

## Browser Compatibility

- Works with all modern browsers supporting localStorage
- Storage limit: typically 5-10MB per domain
- Supported browsers: Chrome, Firefox, Safari, Edge (all recent versions)

## Error Handling

All persistence operations include try-catch blocks:
- Save failures are logged but don't interrupt scan operations
- Load failures gracefully default to null
- Invalid data is ignored and progress clearing is attempted

## Best Practices

1. **Always check for active scan on app initialization**
   ```jsx
   const { scanState, resumeScan } = useScanProgress();
   useEffect(() => {
     if (scanState?.isActive) {
       // Optionally prompt user to resume
     }
   }, []);
   ```

2. **Clear progress when scan completes**
   ```jsx
   const { completeScan } = useScanProgress();
   useEffect(() => {
     if (scanComplete) {
       completeScan();
     }
   }, [scanComplete]);
   ```

3. **Batch state updates for efficiency**
   ```jsx
   updateScanProgress({
     currentStage: nextStage,
     overallProgress: newProgress,
     stages: updatedStages
   });
   ```

## Debugging

### Check Saved State
```javascript
// In browser console
localStorage.getItem('codeguard_scan_progress')
localStorage.getItem('codeguard_scan_progress_expiry')
```

### Clear All Data
```javascript
// In browser console
localStorage.removeItem('codeguard_scan_progress');
localStorage.removeItem('codeguard_scan_progress_expiry');
```

### View Expiry Time
```javascript
// In browser console
const expiry = localStorage.getItem('codeguard_scan_progress_expiry');
console.log('Expires at:', new Date(expiry));
```

## Performance Considerations

- State updates trigger automatic persistence (debouncing recommended for high-frequency updates)
- Consider implementing a debounce wrapper for `updateScanProgress` in high-frequency scenarios
- Current implementation saves on every update; can be optimized with throttling if needed

## Future Enhancements

1. Backend integration for persistent storage
2. Scan history across sessions
3. Export/import scan reports
4. Cloud synchronization
5. Recovery options for interrupted scans
