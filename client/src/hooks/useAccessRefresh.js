import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';

/**
 * Keep the signed-in user's permissions current: when an admin changes their
 * access (or the role matrix), buttons and menus follow without signing in
 * again. Reloads them when the tab comes back into view and every few
 * minutes, and says so when something changed. The server checks every
 * request anyway; this only keeps the screen honest.
 */
const EVERY_MS = 3 * 60 * 1000;
const MIN_GAP_MS = 30 * 1000;

export function useAccessRefresh(loadCompanyContext, enabled) {
  const last = useRef(Date.now());

  useEffect(() => {
    if (!enabled) return undefined;
    const refresh = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - last.current < MIN_GAP_MS) return;
      last.current = Date.now();
      const before = JSON.stringify(useAuthStore.getState().permissions || null);
      await loadCompanyContext();
      const after = JSON.stringify(useAuthStore.getState().permissions || null);
      if (before !== 'null' && after !== 'null' && before !== after) {
        toast('Your access was updated by your admin.', { icon: '🔐', id: 'access-updated' });
      }
    };
    const timer = setInterval(refresh, EVERY_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadCompanyContext, enabled]);
}

export default useAccessRefresh;
