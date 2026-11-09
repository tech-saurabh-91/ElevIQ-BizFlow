import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import PwaPrompts from './components/shell/PwaPrompts';
import { useUIStore } from './store/uiStore';
import './index.css';

// Theme before first paint (avoids flash on reload).
useUIStore.getState().initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = error?.response?.status;
        // Never retry 4xx (auth/permission/validation) — only network/5xx.
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
        <PwaPrompts />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: { background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', border: '1px solid hsl(var(--border))' },
            success: { iconTheme: { primary: 'hsl(var(--success))', secondary: '#fff' } },
            error: { iconTheme: { primary: 'hsl(var(--destructive))', secondary: '#fff' } },
          }}
        />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
