import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import api, { apiError, refreshSession } from '@/api/client';

/**
 * Authentication hook.
 *
 * - `bootstrap()` runs once on mount: if we have a profile but no in-memory
 *   access token (page reload), silently refresh from the httpOnly cookie.
 * - `loginAsCompany` / `loginAsPlatform` hit the respective endpoints.
 * - `logout` revokes the session server-side and clears local state.
 */
export const useAuth = () => {
  const navigate = useNavigate();
  const store = useAuthStore();
  const [bootstrapping, setBootstrapping] = useState(!store.hydrated);
  const [error, setError] = useState(null);

  const bootstrap = useCallback(async () => {
    // Only attempt a refresh if we previously had a session profile.
    // NOTE: several components mount useAuth() at once, so they all reach this
    // line before any token arrives — refreshSession() collapses them into ONE
    // request, otherwise rotation sees a replayed token and revokes the session.
    const { user, accessToken, setSession, clear } = useAuthStore.getState();
    if (accessToken || !user) {
      if (!user) useAuthStore.setState({ status: 'idle' });
      setBootstrapping(false);
      return;
    }
    try {
      const payload = await refreshSession();
      setSession({
        accessToken: payload.accessToken,
        scope: payload.scope,
        user: payload.user,
        company: payload.company,
      });
      // Load permissions + settings for the workspace.
      if (payload.scope === 'company') {
        await loadCompanyContext();
      }
    } catch {
      clear();
    } finally {
      setBootstrapping(false);
    }
  }, []);

  const loadCompanyContext = useCallback(async () => {
    try {
      const { data } = await api.get('/v1/auth/me');
      const me = data?.data?.user || null;
      const state = useAuthStore.getState();
      useAuthStore.setState({
        permissions: data?.data?.permissions || null,
        settings: data?.data?.settings || null,
        company: data?.data?.company || state.company,
        user: me
          ? {
              ...me,
              // While impersonating the JWT carries scope='impersonate', which the
              // /app route guards would reject (infinite <Navigate> loop, blank
              // screen). Present it as a normal company session instead — the
              // amber banner reads `impersonation` from the store, not this.
              scope: state.impersonation ? 'company' : me.scope,
              isImpersonated: Boolean(state.impersonation) || Boolean(me.isImpersonated),
              mustChangePassword: state.impersonation ? false : me.mustChangePassword,
            }
          : state.user,
      });
    } catch (err) {
      // Non-fatal: the app still works with defaults.
      console.warn('loadCompanyContext failed', apiError(err).message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await bootstrap();
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrap]);

  const loginAsCompany = useCallback(
    async ({ identifier, password, companyCode }) => {
      setError(null);
      try {
        const { data } = await api.post('/auth/login', { identifier, password, companyCode });
        const payload = data?.data || {};
        useAuthStore.getState().setSession({
          accessToken: payload.accessToken,
          scope: 'company',
          user: payload.user,
          company: payload.company,
        });
        await loadCompanyContext();
        return { ok: true, data: payload };
      } catch (err) {
        const e = apiError(err);
        setError(e);
        return { ok: false, error: e };
      }
    },
    [loadCompanyContext]
  );

  const loginAsPlatform = useCallback(async ({ email, password }) => {
    setError(null);
    try {
      const { data } = await api.post('/platform/auth/login', { email, password });
      const payload = data?.data || {};
      useAuthStore.getState().setSession({
        accessToken: payload.accessToken,
        scope: 'platform',
        user: payload.user,
        company: null,
      });
      return { ok: true, data: payload };
    } catch (err) {
      const e = apiError(err);
      setError(e);
      return { ok: false, error: e };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      /* ignore – we clear locally regardless */
    }
    const scope = useAuthStore.getState().scope;
    useAuthStore.getState().clear();
    navigate(scope === 'platform' ? '/platform/login' : '/login', { replace: true });
  }, [navigate]);

  const changePassword = useCallback(async ({ currentPassword, newPassword }) => {
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      useAuthStore.getState().clear();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: apiError(err) };
    }
  }, []);

  /**
   * Enter a tenant workspace as its admin (platform scope only).
   * The short-lived impersonation token becomes the session token; the platform
   * session is parked in memory so `exitImpersonation` can restore it.
   */
  const enterImpersonation = useCallback(async (companyId) => {
    setError(null);
    try {
      const { data } = await api.post(`/platform/companies/${companyId}/impersonate`, {});
      const payload = data?.data || {};
      useAuthStore.getState().startImpersonation(payload);
      // Load the tenant's permissions/settings under the impersonation token.
      await loadCompanyContext();
      return { ok: true, data: payload };
    } catch (err) {
      const e = apiError(err);
      setError(e);
      return { ok: false, error: e };
    }
  }, [loadCompanyContext]);

  /**
   * Leave the impersonated workspace and restore the platform session.
   * The server-side exit is best-effort (audit trail); the local restore always
   * happens so a support admin can never get stuck inside a tenant.
   */
  const exitImpersonation = useCallback(async () => {
    const state = useAuthStore.getState();
    const companyId = state.impersonation?.company?.id;
    try {
      // The default interceptor token IS the impersonation token right now.
      await api.post('/platform/impersonation/exit', {});
    } catch {
      /* audit may fail if the token already expired - restore regardless */
    }
    state.endImpersonation();
    return { ok: true, companyId };
  }, []);

  return {
    ...store,
    bootstrap,
    loginAsCompany,
    loginAsPlatform,
    logout,
    changePassword,
    loadCompanyContext,
    enterImpersonation,
    exitImpersonation,
    bootstrapping,
    error,
    clearError: () => setError(null),
  };
};

export default useAuth;
