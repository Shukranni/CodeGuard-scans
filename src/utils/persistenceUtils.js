/**
 * Persistence utilities for managing scan progress state.
 * All keys are namespaced per authenticated user so that switching accounts
 * never surfaces a previous user's scan state.
 */

const BASE_KEY = 'codeguard_scan_progress';
const BASE_EXPIRY_KEY = 'codeguard_scan_progress_expiry';
const STORAGE_EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return a localStorage key scoped to the given userId (or 'anonymous').
 * This prevents one user's scan state from leaking into another user's session.
 */
const scopedKey = (base, userId) =>
  userId ? `${base}_${userId}` : `${base}_anonymous`;

/**
 * Retrieve the current user ID stored in the access-token payload.
 * Falls back to null when unauthenticated.
 */
export const getCurrentUserId = () => {
  try {
    const token = localStorage.getItem('access_token');
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    // SimpleJWT stores the Django user PK in `user_id`
    return payload?.user_id ? String(payload.user_id) : null;
  } catch {
    return null;
  }
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save scan progress to localStorage, scoped to the current user.
 * @param {Object} scanState - The scan state object to persist
 * @param {string|null} [userId] - Override; defaults to the token user ID
 */
export const saveScanProgress = (scanState, userId = getCurrentUserId()) => {
  try {
    const dataToSave = {
      ...scanState,
      lastUpdated: new Date().toISOString(),
    };
    localStorage.setItem(scopedKey(BASE_KEY, userId), JSON.stringify(dataToSave));
    localStorage.setItem(
      scopedKey(BASE_EXPIRY_KEY, userId),
      new Date(Date.now() + STORAGE_EXPIRY_TIME).toISOString()
    );
  } catch (error) {
    console.error('Failed to save scan progress:', error);
  }
};

/**
 * Load scan progress from localStorage for the current user.
 * Returns null if not found, expired, or belonging to a different user.
 * @param {string|null} [userId] - Override; defaults to the token user ID
 * @returns {Object|null}
 */
export const loadScanProgress = (userId = getCurrentUserId()) => {
  try {
    const expiryTime = localStorage.getItem(scopedKey(BASE_EXPIRY_KEY, userId));
    if (expiryTime && new Date() > new Date(expiryTime)) {
      clearScanProgress(userId);
      return null;
    }
    const savedData = localStorage.getItem(scopedKey(BASE_KEY, userId));
    return savedData ? JSON.parse(savedData) : null;
  } catch (error) {
    console.error('Failed to load scan progress:', error);
    return null;
  }
};

/**
 * Clear scan progress from localStorage for the given user.
 * @param {string|null} [userId] - Override; defaults to the token user ID
 */
export const clearScanProgress = (userId = getCurrentUserId()) => {
  try {
    localStorage.removeItem(scopedKey(BASE_KEY, userId));
    localStorage.removeItem(scopedKey(BASE_EXPIRY_KEY, userId));
    // Also clear the legacy un-namespaced 'activeScan' key used by older code
    localStorage.removeItem('activeScan');
  } catch (error) {
    console.error('Failed to clear scan progress:', error);
  }
};

/**
 * Clear ALL scan progress keys for every user stored in localStorage.
 * Use on full logout to remove any residual state.
 */
export const clearAllScanProgress = () => {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(BASE_KEY) || key.startsWith(BASE_EXPIRY_KEY))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem('activeScan');
  } catch (error) {
    console.error('Failed to clear all scan progress:', error);
  }
};

/**
 * Check if there is an active scan in progress for the current user.
 * @returns {boolean}
 */
export const hasActiveScan = () => {
  const scanState = loadScanProgress();
  return scanState?.isActive === true;
};

/**
 * Get the last saved scan timestamp for the current user.
 * @returns {string|null} ISO string of last update or null
 */
export const getLastScanUpdate = () => {
  const scanState = loadScanProgress();
  return scanState?.lastUpdated || null;
};

/**
 * Export scan progress data for the current user.
 * @returns {Object|null}
 */
export const exportScanProgress = () => loadScanProgress();

/**
 * Import scan progress data for the current user.
 * @param {Object} scanData
 */
export const importScanProgress = (scanData) => {
  if (scanData && typeof scanData === 'object') {
    saveScanProgress(scanData);
  }
};
