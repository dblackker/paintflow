export const API_URL = import.meta.env.PUBLIC_API_URL
  || import.meta.env.VITE_API_URL
  || `${window.location.protocol}//${window.location.hostname}:8787`;

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  const response = await fetch(url, { credentials: 'include', ...options });

  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || body?.message || 'Request failed');
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
