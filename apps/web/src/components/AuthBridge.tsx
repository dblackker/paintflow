import { useEffect } from 'react';
import { API_URL } from '@/lib/api';

export function AuthBridge() {
  useEffect(() => {
    const configuredApiUrl = API_URL || import.meta.env.PUBLIC_API_URL || import.meta.env.VITE_API_URL || '';
    const allowSessionFallback = import.meta.env.DEV
      || ['localhost', '127.0.0.1'].includes(window.location.hostname)
      || window.location.hostname === 'paintflow-demo.pages.dev'
      || configuredApiUrl.includes('paintflow-api-demo');

    if (!allowSessionFallback) return;

    const storageKey = 'paintflow.sessionToken';
    const configuredApiOrigin = configuredApiUrl ? new URL(configuredApiUrl, window.location.origin).origin : '';
    const fallbackApiOrigin = `${window.location.protocol}//${window.location.hostname}:8787`;
    const demoApiOrigin = window.location.hostname === 'paintflow-demo.pages.dev'
      ? 'https://paintflow-api-demo.danielablack.workers.dev'
      : '';
    const apiOrigins = new Set([configuredApiOrigin, fallbackApiOrigin, demoApiOrigin].filter(Boolean));
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const search = new URLSearchParams(window.location.search);
    const sessionToken = hash.get('paintflow_session') || search.get('paintflow_session');
    let memorySessionToken = sessionToken || '';

    function getStoredToken() {
      try {
        return localStorage.getItem(storageKey) || memorySessionToken;
      } catch {
        return memorySessionToken;
      }
    }

    function setStoredToken(value: string) {
      memorySessionToken = value;
      try {
        localStorage.setItem(storageKey, value);
      } catch {
        // Keep an in-memory fallback so the current page can still authorize API calls.
      }
    }

    function clearStoredToken() {
      memorySessionToken = '';
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // Ignore storage failures; clearing memory is enough for this page.
      }
    }

    if (sessionToken) {
      setStoredToken(sessionToken);
      hash.delete('paintflow_session');
      search.delete('paintflow_session');
      const cleanUrl = `${window.location.pathname}${search.toString() ? `?${search}` : ''}${hash.toString() ? `#${hash}` : ''}`;
      window.history.replaceState(null, '', cleanUrl || window.location.pathname);
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
      const token = getStoredToken();
      if (!token) return originalFetch(input, init);

      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      let shouldAttach = false;
      try {
        const url = new URL(requestUrl, window.location.origin);
        shouldAttach = apiOrigins.has(url.origin);
      } catch {
        shouldAttach = false;
      }

      if (!shouldAttach) return originalFetch(input, init);

      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      return originalFetch(input, { ...init, headers });
    };

    window.PaintFlowAuth = { clearSessionFallback: clearStoredToken };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
