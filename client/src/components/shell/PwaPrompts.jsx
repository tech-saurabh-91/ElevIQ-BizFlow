import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, RefreshCw, Share, SquarePlus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Installable app + "new version" prompt.
 *
 *  - Install: browsers that support it (Android Chrome, Edge, desktop
 *    Chrome) fire `beforeinstallprompt`; we keep it and show our own popup
 *    on phones, plus an "Install app" button in the top bar. iPhone Safari
 *    has no such event, so it gets "Share -> Add to Home Screen" steps.
 *  - Update: the service worker downloads a new deploy in the background;
 *    a banner offers "Update now", which switches to it and reloads.
 */

const DISMISS_KEY = 'eleviq_install_dismissed_at';
const DISMISS_DAYS = 7;
const UPDATE_CHECK_MS = 30 * 60 * 1000;

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
const isPhone = () => window.matchMedia?.('(max-width: 768px)').matches || /android|iphone|ipod/i.test(window.navigator.userAgent);
const dismissedRecently = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at && Date.now() - at < DISMISS_DAYS * 86400000;
  } catch {
    return false;
  }
};
const rememberDismiss = () => {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* private mode: ask again next time */
  }
};

/** The browser's saved install prompt, shared with the top bar button. */
export const useInstallStore = create((set, get) => ({
  promptEvent: null,
  installed: false,
  setPrompt: (promptEvent) => set({ promptEvent }),
  setInstalled: () => set({ installed: true, promptEvent: null }),
  install: async () => {
    const event = get().promptEvent;
    if (!event) return false;
    event.prompt();
    const choice = await event.userChoice.catch(() => null);
    set({ promptEvent: null });
    return choice?.outcome === 'accepted';
  },
}));

// Catch the event as early as possible (it may fire before React mounts).
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    useInstallStore.getState().setPrompt(e);
  });
  window.addEventListener('appinstalled', () => useInstallStore.getState().setInstalled());
}

/** "Install app" button for the top bar (shown only when installable). */
export function InstallButton() {
  const promptEvent = useInstallStore((s) => s.promptEvent);
  const install = useInstallStore((s) => s.install);
  if (!promptEvent) return null;
  return (
    <button
      type="button"
      onClick={install}
      className="hidden h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium hover:bg-accent focus-ring sm:inline-flex"
      title="Install ElevIQ SFA on this device"
    >
      <Download className="h-4 w-4" /> Install app
    </button>
  );
}

function InstallSheet() {
  const promptEvent = useInstallStore((s) => s.promptEvent);
  const install = useInstallStore((s) => s.install);
  const [open, setOpen] = useState(false);
  const ios = isIos();

  useEffect(() => {
    if (isStandalone() || dismissedRecently() || !isPhone()) return undefined;
    // Android / Chrome: once the browser says it is installable. iPhone: after a moment.
    if (promptEvent) {
      setOpen(true);
      return undefined;
    }
    if (ios) {
      const t = setTimeout(() => setOpen(true), 4000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [promptEvent, ios]);

  if (!open) return null;
  const close = () => {
    rememberDismiss();
    setOpen(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:bottom-4 sm:left-auto sm:right-4 sm:max-w-sm" role="dialog" aria-label="Install the app">
      <div className="rounded-xl border bg-popover p-4 text-popover-foreground shadow-2xl">
        <div className="flex items-start gap-3">
          <img src="/pwa-192x192.png" alt="" className="h-12 w-12 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Install ElevIQ SFA</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Add the app to your home screen: it opens full screen, faster, like any other app.
            </p>
          </div>
          <button type="button" onClick={close} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Not now">
            <X className="h-4 w-4" />
          </button>
        </div>
        {promptEvent ? (
          <div className="mt-3 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={close}>
              Not now
            </Button>
            <Button
              className="flex-1"
              onClick={async () => {
                const ok = await install();
                if (!ok) rememberDismiss();
                setOpen(false);
              }}
            >
              <Download className="h-4 w-4" /> Install
            </Button>
          </div>
        ) : (
          <ol className="mt-3 space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              1. Tap <Share className="h-4 w-4 text-brand-600" /> <strong>Share</strong> in Safari
            </li>
            <li className="flex items-center gap-2">
              2. Choose <SquarePlus className="h-4 w-4 text-brand-600" /> <strong>Add to Home Screen</strong>
            </li>
          </ol>
        )}
      </div>
    </div>
  );
}

function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Look for a new deploy now and then, and whenever the app comes back to the screen.
      setInterval(() => registration.update().catch(() => {}), UPDATE_CHECK_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      });
    },
  });
  const [updating, setUpdating] = useState(false);
  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[70] flex justify-center p-2" role="status">
      <div className="flex w-full max-w-xl items-center gap-3 rounded-xl border bg-popover px-4 py-3 text-popover-foreground shadow-2xl">
        <RefreshCw className="h-5 w-5 shrink-0 text-brand-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">New update available</p>
          <p className="text-xs text-muted-foreground">Save your work, then update to get the latest changes.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
          Later
        </Button>
        <Button
          size="sm"
          loading={updating}
          onClick={() => {
            setUpdating(true);
            updateServiceWorker(true);
          }}
        >
          Update now
        </Button>
      </div>
    </div>
  );
}

/** Mounted once at the app root. */
export default function PwaPrompts() {
  return (
    <>
      <UpdateBanner />
      <InstallSheet />
    </>
  );
}
