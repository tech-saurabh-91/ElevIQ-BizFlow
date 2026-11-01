import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Auth store.
 *
 * The ACCESS token is deliberately NOT persisted to localStorage (XSS risk);
 * only non-sensitive profile data is. On a full page reload the app calls
 * `/auth/refresh` to obtain a fresh access token from the httpOnly cookie.
 */
export const useAuthStore = create(
  persist(
    (set, get) => ({
      accessToken: null,
      scope: null, // 'platform' | 'company'
      user: null,
      company: null,
      permissions: null,
      settings: null,
      status: 'idle', // idle | loading | authenticated | error
      hydrated: false,
      /**
       * Impersonation session (MEMORY ONLY - never persisted via partialize).
       * `platform` keeps the platform admin's session so we can restore it on exit.
       */
      impersonation: null,

      setHydrated: () => set({ hydrated: true }),

      setSession: ({ accessToken, scope, user, company, permissions, settings }) =>
        set({
          accessToken: accessToken ?? null,
          scope: scope ?? user?.scope ?? null,
          user: user ?? null,
          company: company ?? null,
          permissions: permissions ?? null,
          settings: settings ?? null,
          status: user ? 'authenticated' : 'idle',
        }),

      /** After a silent refresh: keep profile, swap the token (and scope). */
      applyRefresh: (payload = {}) =>
        set((state) => ({
          accessToken: payload.accessToken ?? state.accessToken,
          scope: payload.scope ?? state.scope,
          user: payload.user ?? state.user,
          // A platform refresh must not keep a stale tenant company around
          // (e.g. after reloading mid-impersonation).
          company: payload.scope === 'company' ? payload.company ?? state.company : null,
          status: payload.user ? 'authenticated' : state.status,
        })),

      /**
       * Enter a tenant workspace with a short-lived impersonation token.
       * The platform session is parked in `impersonation.platform` (memory only)
       * so "Exit workspace" can restore it without asking for credentials.
       */
      startImpersonation: ({ accessToken, company, actingAs, startedAt }) =>
        set((state) => ({
          accessToken: accessToken ?? null,
          scope: 'company',
          user: {
            id: actingAs?.id,
            name: actingAs?.name || '',
            email: actingAs?.email || '',
            role: actingAs?.role || '',
            title: actingAs?.title || '',
            // Client-side scope so the /app guards accept the session; the JWT
            // itself still carries scope='impersonate' on the server.
            scope: 'company',
            isImpersonated: true,
            mustChangePassword: false,
          },
          company: company ?? null,
          permissions: null,
          settings: null,
          status: 'authenticated',
          impersonation: {
            company: company ? { id: company.id, name: company.name, code: company.code } : null,
            actingAs: actingAs ?? null,
            startedAt: startedAt || new Date().toISOString(),
            platform: {
              accessToken: state.accessToken,
              user: state.user,
              scope: state.scope,
            },
          },
        })),

      /** Restore the parked platform session (idempotent). */
      endImpersonation: () =>
        set((state) => {
          const parked = state.impersonation?.platform;
          return {
            accessToken: parked?.accessToken ?? null,
            scope: parked?.scope ?? 'platform',
            user: parked?.user ?? null,
            company: null,
            permissions: null,
            settings: null,
            status: parked?.user ? 'authenticated' : 'idle',
            impersonation: null,
          };
        }),

      setPermissions: (permissions) => set({ permissions }),
      setSettings: (settings) => set({ settings }),
      setCompany: (company) => set({ company }),

      clear: () =>
        set({
          accessToken: null,
          scope: null,
          user: null,
          company: null,
          permissions: null,
          settings: null,
          status: 'idle',
          impersonation: null,
        }),

      // ---- derived helpers -------------------------------------------
      isAuthenticated: () => Boolean(get().user),
      isPlatform: () => get().scope === 'platform',
      isCompany: () => get().scope === 'company',
      isImpersonating: () => Boolean(get().impersonation),

      /** Permission check against the effective company role matrix. */
      can: (permission) => {
        const { user, permissions } = get();
        if (!user) return false;
        if (user.scope === 'platform') return true; // platform route guards separately
        if (user.role === 'COMPANY_ADMIN') return true;
        const list = permissions?.[permission];
        if (!Array.isArray(list)) return false;
        return list.includes(user.role);
      },
    }),
    {
      name: 'eleviq_auth',
      version: 1,
      // Never persist the token or permissions blob.
      partialize: (state) => ({
        scope: state.scope,
        user: state.user,
        company: state.company,
        status: state.status,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated?.();
      },
    }
  )
);

export default useAuthStore;
