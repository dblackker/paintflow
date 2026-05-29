function resolveApiUrl() {
  const configuredUrl = import.meta.env.PUBLIC_API_URL || import.meta.env.VITE_API_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, '');

  if (typeof window !== 'undefined' && ['crewmodo.com', 'www.crewmodo.com', 'app.crewmodo.com'].includes(window.location.hostname)) {
    return 'https://api.crewmodo.com';
  }

  if (typeof window !== 'undefined' && window.location.hostname === 'staging.crewmodo.com') {
    return 'https://api-staging.crewmodo.com';
  }

  if (typeof window !== 'undefined' && window.location.hostname === 'crewmodo-dev.pages.dev') {
    return 'https://crewmodo-api-dev.danielablack.workers.dev';
  }

  return `${window.location.protocol}//${window.location.hostname}:8787`;
}

export const API_URL = resolveApiUrl();

function storedSessionToken() {
  if (typeof window === 'undefined') return '';
  const hashToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('crewmodo_session');
  const searchToken = new URLSearchParams(window.location.search).get('crewmodo_session');
  if (hashToken || searchToken) return hashToken || searchToken || '';
  try {
    return localStorage.getItem('crewmodo.sessionToken') || '';
  } catch {
    return '';
  }
}

function shouldAttachSession(url: string) {
  if (typeof window === 'undefined') return false;
  try {
    const requestOrigin = new URL(url, window.location.origin).origin;
    const configuredOrigin = new URL(API_URL, window.location.origin).origin;
    const localOrigin = `${window.location.protocol}//${window.location.hostname}:8787`;
    const devOrigin = 'https://crewmodo-api-dev.danielablack.workers.dev';
    return requestOrigin === configuredOrigin || requestOrigin === localOrigin || requestOrigin === devOrigin;
  } catch {
    return false;
  }
}

export class CrewmodoApiError extends Error {
  status?: number;
  code?: string;
  serviceUnavailable: boolean;

  constructor(message: string, options: { status?: number; code?: string; serviceUnavailable?: boolean } = {}) {
    super(message);
    this.name = 'CrewmodoApiError';
    this.status = options.status;
    this.code = options.code;
    this.serviceUnavailable = Boolean(options.serviceUnavailable);
  }
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  const token = storedSessionToken();
  const headers = new Headers(options.headers || {});
  if (token && shouldAttachSession(url) && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include', ...options, headers });
  } catch {
    throw new CrewmodoApiError('Crewmodo API is unreachable. The app loaded, but the service that provides this page data did not respond.', {
      serviceUnavailable: true,
      code: 'NETWORK_UNREACHABLE',
    });
  }

  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const statusUnavailable = response.status === 502 || response.status === 503 || response.status === 504;
    throw new CrewmodoApiError(
      body?.error || body?.message || (statusUnavailable ? 'Crewmodo API is temporarily unavailable.' : 'Request failed'),
      {
        status: response.status,
        code: body?.code,
        serviceUnavailable: statusUnavailable,
      },
    );
  }

  return body as T;
}

export function formatMoney(value: unknown, cents = false) {
  const amount = Number(value || 0) / (cents ? 100 : 1);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPhone(value?: string | null) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return raw;
}

export function formatAddress(item: {
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
  leadPostalCode?: string | null;
}) {
  const street = item.streetAddress || item.leadStreetAddress || '';
  const city = item.city || item.leadCity || '';
  const state = item.state || item.leadState || '';
  const postal = String(item.postalCode || item.leadPostalCode || '').slice(0, 5);
  const locality = [city, state].filter(Boolean).join(', ');
  return [street, [locality, postal].filter(Boolean).join(' ')].filter(Boolean).join(' ');
}

export function labelize(value?: string | null) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
