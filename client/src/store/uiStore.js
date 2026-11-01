import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** UI store: theme, sidebar, breadcrumbs, global command palette. */
export const useUIStore = create(
  persist(
    (set, get) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      mobileNavOpen: false,
      breadcrumbs: [],

      setTheme: (theme) => {
        set({ theme });
        try {
          localStorage.setItem('eleviq_theme', theme);
        } catch {
          /* ignore */
        }
        const root = document.documentElement;
        if (theme === 'dark') root.classList.add('dark');
        else root.classList.remove('dark');
      },

      toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileNav: (open) => set({ mobileNavOpen: open }),
      setBreadcrumbs: (crumbs) => set({ breadcrumbs: crumbs || [] }),

      /** Read the initial theme from localStorage / system preference. */
      initTheme: () => {
        let stored = null;
        try {
          stored = localStorage.getItem('eleviq_theme');
        } catch {
          /* ignore */
        }
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
        const theme = stored || (prefersDark ? 'dark' : 'light');
        set({ theme });
        document.documentElement.classList.toggle('dark', theme === 'dark');
      },
    }),
    {
      name: 'eleviq_ui',
      partialize: (s) => ({ theme: s.theme, sidebarCollapsed: s.sidebarCollapsed }),
    }
  )
);

export default useUIStore;
