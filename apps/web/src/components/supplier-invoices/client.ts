import { API_URL, CrewmodoApiError } from '@/lib/api';
import type { InvoiceImport, MaterialPurchase } from './types';

interface SupplierErrorPayload {
  error?: string;
  message?: string;
  code?: string;
  duplicate?: boolean;
  duplicateType?: 'import' | 'purchase';
  data?: InvoiceImport | MaterialPurchase;
}

export class SupplierRequestError extends CrewmodoApiError {
  payload: SupplierErrorPayload;

  constructor(status: number, payload: SupplierErrorPayload) {
    super(payload.error || payload.message || 'Supplier invoice request failed. Please try again.', { status, code: payload.code });
    this.payload = payload;
  }
}

// This adapter retains conflict context that the generic JSON helper discards.
// Only fixed, same-API supplier paths may receive the session credential.
export async function supplierResponse(path: string, options: RequestInit = {}) {
  const url = new URL(path, `${API_URL}/`);
  if (url.origin !== new URL(API_URL).origin || !url.pathname.startsWith('/v1/invoices/')) {
    throw new Error('Invalid supplier invoice destination.');
  }
  const headers = new Headers(options.headers);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const search = new URLSearchParams(window.location.search);
  let token = hash.get('crewmodo_session') || search.get('crewmodo_session') || '';
  try { token ||= localStorage.getItem('crewmodo.sessionToken') || ''; } catch { /* Cookie auth remains available. */ }
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120_000);
  try {
    response = await fetch(url, { ...options, headers, credentials: 'include', signal: options.signal || controller.signal });
  } catch {
    if (controller.signal.aborted) throw new CrewmodoApiError('The request took too long. Your file and details are kept; retry to check the result.', { code: 'REQUEST_TIMEOUT', serviceUnavailable: true });
    throw new CrewmodoApiError('Connection lost. Your changes are kept; try again when you are online.', { code: 'NETWORK_UNREACHABLE', serviceUnavailable: true });
  } finally {
    window.clearTimeout(timeout);
  }
  if (response.status === 401) {
    window.location.assign('/login');
    throw new CrewmodoApiError('Your session expired. Sign in to continue.', { status: 401 });
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as SupplierErrorPayload;
    throw new SupplierRequestError(response.status, payload);
  }
  return response;
}

export async function supplierJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await supplierResponse(path, options)).json() as Promise<T>;
}

export function supplierErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The invoice could not be saved. Try again.';
}
