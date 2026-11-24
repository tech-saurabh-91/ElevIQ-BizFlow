import axios from 'axios';
import { API_BASE } from '@/api/client';
import { usePortalStore } from './portalStore';

/**
 * Axios instance for the customer portal (/api/portal/*).
 *
 * Same pattern as the staff client (api/client.js) - access token in memory,
 * single-flight refresh on 401 - but its own token, its own refresh endpoint
 * and its own cookie, so it never touches a staff session.
 */
const portalApi = axios.create({
  baseURL: `${API_BASE}/portal`,
  withCredentials: true,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

portalApi.interceptors.request.use((config) => {
  const token = usePortalStore.getState().accessToken;
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshPromise = null;

/** One refresh at a time: portal refresh tokens rotate like staff ones. */
export const refreshPortal = () => {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_BASE}/portal/auth/refresh`, {}, { withCredentials: true })
      .then(({ data }) => {
        const payload = data?.data || {};
        usePortalStore.getState().setSession(payload);
        return payload;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

const toLogin = () => {
  usePortalStore.getState().clear();
  const match = window.location.pathname.match(/^\/portal\/([^/]+)/);
  const target = match ? `/portal/${match[1]}/login` : '/';
  if (window.location.pathname !== target) window.location.assign(target);
};

portalApi.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config || {};
    const status = error.response?.status;
    const isAuthCall = /\/auth\/(login|refresh|logout)/.test(original.url || '');
    if (status === 401 && !original._retried && !isAuthCall) {
      original._retried = true;
      try {
        const payload = await refreshPortal();
        if (payload?.accessToken) {
          original.headers.Authorization = `Bearer ${payload.accessToken}`;
          return portalApi(original);
        }
      } catch (refreshError) {
        toLogin();
        return Promise.reject(refreshError);
      }
    }
    // Online ordering switched off for this customer or company: back to login,
    // which explains it.
    const code = error.response?.data?.code;
    if (status === 403 && ['PORTAL_DISABLED', 'PORTAL_ACCESS_OFF'].includes(code) && !isAuthCall) {
      toLogin();
    }
    return Promise.reject(error);
  }
);

/** Fetch a PDF with the portal token and open it (new tab, or download on iOS). */
export const openPortalPdf = async (path, params = {}, filename = 'document.pdf') => {
  const { data } = await portalApi.get(path, { params, responseType: 'blob' });
  const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
  const win = window.open(url, '_blank');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

export default portalApi;
