/**
 * Auth-specific API calls. All requests go through the shared Axios instance
 * so tokens are auto-attached and refresh logic runs transparently.
 */
import api from '../utils/api';

/**
 * Register a new user.
 * @param {{ first_name: string, last_name?: string, email: string, password: string, confirm_password: string }} data
 */
export const register = (data) => api.post('/api/auth/register/', data);

/**
 * Login with email + password.
 * @param {{ email: string, password: string }} data
 */
export const login = (data) =>
  api.post('/api/auth/login/', {
    email: data.email.trim().toLowerCase(),
    password: data.password,
  });

/**
 * Logout — blacklists the current refresh token.
 * @param {string} refreshToken
 */
export const logout = (refreshToken) =>
  api.post('/api/auth/logout/', { refresh: refreshToken });

/**
 * Get the currently-authenticated user's profile.
 */
export const getMe = () => api.get('/api/auth/me/');

/**
 * Update editable profile fields (first_name, last_name).
 * @param {{ first_name?: string, last_name?: string }} data
 */
export const updateMe = (data) => api.patch('/api/auth/me/', data);

/**
 * Change the authenticated user's password.
 * Returns new JWT tokens on success so the session stays valid.
 * @param {{ current_password: string, new_password: string, confirm_password: string }} data
 */
export const changePassword = (data) =>
  api.post('/api/auth/change-password/', data);

/**
 * Refresh the access token using the stored refresh token.
 * @param {string} refreshToken
 */
export const refreshAccessToken = (refreshToken) =>
  api.post('/api/auth/token/refresh/', { refresh: refreshToken });
