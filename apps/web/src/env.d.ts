/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PUBLIC_API_URL?: string;
  readonly VITE_API_URL?: string;
}

interface Window {
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
  PaintFlowAuth?: {
    clearSessionFallback: () => void;
  };
}
