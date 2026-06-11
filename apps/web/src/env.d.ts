/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PUBLIC_API_URL?: string;
  readonly VITE_API_URL?: string;
  readonly PUBLIC_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

interface Window {
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
  CrewmodoAuth?: {
    clearSessionFallback: () => void;
  };
}
