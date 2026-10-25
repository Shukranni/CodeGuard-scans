/**
 * Centralised Axios instance for all API communication.
 * Automatically attaches the JWT access token and handles 401 token refresh.
 */
import axios from 'axios';
import { notifyApiError } from '../utils/notifications';

const RAW_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

// Hosting dashboards often provide the API host without a scheme
// (e.g. "codeguard-api.onrender.com").  Normalise it so axios always gets a
// fully qualified URL, and strip any trailing slash.
const BASE_URL = /^https?:\/\//i.test(RAW_BASE_URL)
  ? RAW_BASE_URL.replace(/\/+$/, '')
  : `https://${RAW_BASE_URL.replace(/\/+$/, '')}`;

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor: attach access token ─────────────────────────────────
api.interceptors.request.use((config) => {
  const access = localStorage.getItem('access_token');
  if (access) {
    config.headers['Authorization'] = `Bearer ${access}`;
  }
  return config;
});

// ── Response interceptor: transparent token refresh on 401 ───────────────────
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/api/auth/login') &&
      !originalRequest.url?.includes('/api/auth/token/refresh')
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers['Authorization'] = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refresh = localStorage.getItem('refresh_token');
        if (!refresh) throw new Error('No refresh token');

        const { data } = await axios.post(`${BASE_URL}/api/auth/token/refresh/`, {
          refresh,
        });

        localStorage.setItem('access_token', data.access);
        // SimpleJWT with ROTATE_REFRESH_TOKENS sends a new refresh token
        if (data.refresh) localStorage.setItem('refresh_token', data.refresh);

        processQueue(null, data.access);
        originalRequest.headers['Authorization'] = `Bearer ${data.access}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        // Clear tokens and let the AuthContext handle the redirect
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.dispatchEvent(new Event('auth:logout'));
        notifyApiError(refreshError, 'Your session has expired. Please sign in again.');
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    if (originalRequest?._silentError !== true) {
      const status = error?.response?.status;
      const isExpected = status === 401 || status === 403 || status === 404 || status === 409 || status === 413 || status === 429;
      if (!error?.response || status >= 500 || !isExpected) {
        notifyApiError(error, 'Something went wrong. Please try again.');
      }
    }

    return Promise.reject(error);
  },
);

export default api;
