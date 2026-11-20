import { Component } from 'react';
import { ErrorState } from '@/components/ui/empty-state';

/**
 * Catches a page that fails to render - most often a lazy page chunk that
 * cannot be fetched (offline before the app was cached on this device, or an
 * old tab asking for files a new deploy replaced). Without it the whole app
 * unmounts to a blank screen. Remount it per route (`key`) so navigating away
 * clears the error.
 */
export default class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('Page failed to load', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return (
      <ErrorState
        title={offline ? "You're offline" : 'This page could not be loaded'}
        message={
          offline
            ? 'This page is not saved on this device yet. Reconnect, then try again.'
            : 'The app may have been updated. Try again to load the latest version.'
        }
        onRetry={() => window.location.reload()}
      />
    );
  }
}
