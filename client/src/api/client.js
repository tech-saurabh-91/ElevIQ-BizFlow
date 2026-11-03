import axios from 'axios';
import { useAuthStore } from '@/store/authStore';

/**
 * Axios instance for the ElevIQ SFA API.
 *
 * - Access token (15 min) lives in memory (Zustand) and is attached as Bearer.
 * - Refresh token is an httpOnly cookie, so we never read/write it in JS.
 * - A single-flight interceptor transparently refreshes on 401 and replays the
 *   original request exactly once.
 * - On refresh failure we sign out and redirect to the matching login page.
 */

export const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// ---- request: attach access token ----------------------------------------
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ---- response: single-flight refresh --------------------------------------
/**
 * Refresh tokens ROTATE on every use and the server treats a replayed token as
 * theft (REFRESH_REUSE -> whole session family revoked). Two components racing
 * to refresh on a cold page load would therefore sign the user out. Every
 * refresh in the app MUST go through this one shared promise.
 */
let refreshPromise = null;

const doRefresh = async () => {
  const { data } = await axios.post(`${API_BASE}/auth/refresh`, {}, { withCredentials: true });
  const payload = data?.data || {};
  useAuthStore.getState().applyRefresh(payload);
  return payload;
};

/** Returns the in-flight refresh, starting one only if none exists. */
export const refreshSession = () => {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

const forceLogout = () => {
  const state = useAuthStore.getState();
  // Never "log out" a support admin who was impersonating: restore them.
  if (state.impersonation) {
    state.endImpersonation();
    window.location.assign('/platform/companies');
    return;
  }
  state.clear();
  const path = window.location.pathname;
  const target = path.startsWith('/platform') ? '/platform/login' : '/login';
  if (window.location.pathname !== target) {
    window.location.assign(target);
  }
};

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const code = error.response?.data?.code;
    const url = original?.url || '';

    const isAuthCall = /\/auth\/(login|refresh|logout)/.test(url);

    // Workspace in maintenance mode: sign non-admins out and show the message
    // on the login page.
    if (status === 503 && code === 'MAINTENANCE' && !isAuthCall) {
      try {
        sessionStorage.setItem('eleviq.maintenance', error.response?.data?.message || '');
      } catch {
        /* storage unavailable: the login page falls back to a generic notice */
      }
      forceLogout();
      return Promise.reject(error);
    }

    // Impersonation tokens are short-lived (30 min) and have NO refresh cookie
    // of their own - the cookie belongs to the platform admin. Refreshing would
    // silently bounce us out of the workspace, so exit cleanly instead.
    if (status === 401 && useAuthStore.getState().impersonation && !original._retried) {
      original._retried = true;
      forceLogout();
      return Promise.reject(error);
    }

    // Only attempt a refresh for a 401 that isn't already an auth call,
    // and only once per request.
    if (status === 401 && !original._retried && !isAuthCall) {
      original._retried = true;
      try {
        const payload = await refreshSession();
        const newToken = payload?.accessToken;
        if (newToken) {
          original.headers.Authorization = `Bearer ${newToken}`;
          return api(original);
        }
      } catch (refreshError) {
        // Refresh failed (expired / revoked / suspended) -> sign out.
        if (['TOKEN_EXPIRED', 'TOKEN_INVALID', 'REFRESH_REUSE', 'COMPANY_SUSPENDED', 'COMPANY_EXPIRED'].includes(
          refreshError.response?.data?.code || code
        )) {
          forceLogout();
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error)
  }
);

/** Normalise an API error into something UI-friendly. */
export const apiError = (error) => {
  const res = error?.response;
  if (!res) {
    return {
      message: error?.code === 'ECONNABORTED' ? 'Request timed out. Please try again.' : 'Network error. Check your connection.',
      code: 'NETWORK_ERROR',
      errors: [],
      status: 0,
    };
  }
  const data = res.data || {};
  return {
    message: data.message || 'Something went wrong',
    code: data.code || 'ERROR',
    errors: Array.isArray(data.errors) ? data.errors : [],
    status: res.status,
    requestId: data.requestId,
    details: data.details,
  };
};

/** Turn a field: 'body.email' error list into a react-hook-form fieldErrors map. */
export const toFieldErrors = (errors = []) =>
  errors.reduce((acc, e) => {
    const field = (e.field || '').replace(/^body\./, '').replace(/^query\./, '');
    if (field && field !== '_') acc[field] = e.message;
    return acc;
  }, {});

export default api;
