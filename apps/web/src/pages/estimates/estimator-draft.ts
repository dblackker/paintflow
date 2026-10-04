import { useEffect, useRef, useState } from 'react';
import { apiJson } from '@/lib/api';

export interface EstimatorDraftAccount { orgId: string; userId: string }
export const ESTIMATOR_DRAFT_ACCOUNT_EVENT = 'crewmodo:estimator-account';
export const ESTIMATOR_DRAFT_CLEANUP_EVENT = 'crewmodo:estimator-drafts-clear';
export const ESTIMATOR_DRAFT_PREFIX = 'crewmodo.estimator-draft.v2:';
export const ESTIMATOR_DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DRAFT_BYTES = 2_000_000;

declare global {
  interface Window {
    CrewmodoEstimatorAccount?: EstimatorDraftAccount | null;
    posthog?: { capture: (event: string, properties?: Record<string, unknown>) => void };
  }
}

export function estimatorEvent(action: string, properties: Record<string, unknown> = {}) {
  // No customer, room, product, account or document identifiers in analytics.
  try { window.posthog?.capture(`estimator.${action}`, { ...properties, $process_person_profile: false }); } catch { /* Analytics must not block editing. */ }
}

function accountIdentity(account?: EstimatorDraftAccount | null) {
  return account?.orgId && account?.userId ? JSON.stringify([account.orgId, account.userId]) : '';
}

export function clearEstimatorDrafts() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(ESTIMATOR_DRAFT_PREFIX)) localStorage.removeItem(key);
  } catch { /* Storage may be unavailable on shared/private devices. */ }
}

/** Auth owner calls this before switch/signout, even when the editor is not mounted. */
export function setEstimatorDraftAccount(account: EstimatorDraftAccount | null) {
  updateAccount(account);
  window.dispatchEvent(new CustomEvent(ESTIMATOR_DRAFT_ACCOUNT_EVENT, { detail: account }));
}

function updateAccount(account: EstimatorDraftAccount | null) {
  const nextIdentity = accountIdentity(account);
  const previousIdentity = accountIdentity(window.CrewmodoEstimatorAccount);
  if (!nextIdentity || (previousIdentity && previousIdentity !== nextIdentity)) clearEstimatorDrafts();
  else {
    // First authenticated load retains this account's drafts, never another account's.
    try {
      const accountPrefix = ESTIMATOR_DRAFT_PREFIX + encodeURIComponent(nextIdentity) + ':';
      for (const key of Object.keys(localStorage)) if (key.startsWith(ESTIMATOR_DRAFT_PREFIX) && !key.startsWith(accountPrefix)) localStorage.removeItem(key);
    } catch { /* Recovery remains optional. */ }
  }
  window.CrewmodoEstimatorAccount = account;
}

let bridgeInstalled = false;
function installAccountBridge() {
  if (bridgeInstalled) return;
  bridgeInstalled = true;
  window.addEventListener(ESTIMATOR_DRAFT_ACCOUNT_EVENT, ((event: CustomEvent<EstimatorDraftAccount | null>) => {
    updateAccount(event.detail);
  }) as EventListener);
  window.addEventListener(ESTIMATOR_DRAFT_CLEANUP_EVENT, () => {
    clearEstimatorDrafts();
    window.CrewmodoEstimatorAccount = null;
  });
}

interface DraftEnvelope<T> { version: 2; savedAt: number; baseVersion: string; value: T }

// Auth/401 cleanup events work as soon as the auth owner imports this helper.
if (typeof window !== 'undefined') installAccountBridge();

export function useEstimatorDraft<T>({ estimateKey, baseVersion, value, enabled, validate, onAccountChange }: {
  estimateKey: string; baseVersion: string; value: T; enabled: boolean; validate: (value: unknown) => value is T; onAccountChange?: () => void;
}) {
  const [account, setAccount] = useState<EstimatorDraftAccount | null>(() => window.CrewmodoEstimatorAccount || null);
  const [candidate, setCandidate] = useState<DraftEnvelope<T> | null>(null);
  const [status, setStatus] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const accountId = accountIdentity(account);
  const key = accountId ? ESTIMATOR_DRAFT_PREFIX + encodeURIComponent(accountId) + ':' + encodeURIComponent(estimateKey) : '';
  const serialized = JSON.stringify(value);
  const current = useRef({ serialized, baseVersion });
  current.current = { serialized, baseVersion };
  const state = useRef({ key: '', blocked: true, baseline: '', saved: '', suppressed: false });
  const accountChangeCallback = useRef(onAccountChange);
  accountChangeCallback.current = onAccountChange;

  useEffect(() => {
    let active = true;
    let generation = 0;
    const invalidate = () => { generation++; };
    async function confirmAccount() {
      const requestGeneration = generation;
      try {
        const response = await apiJson<{ data: EstimatorDraftAccount }>('/v1/auth/session');
        if (!active || generation !== requestGeneration) return;
        if (typeof response.data?.orgId !== 'string' || typeof response.data?.userId !== 'string' || !accountIdentity(response.data)) throw new Error('Account identity unavailable');
        setEstimatorDraftAccount({ orgId: response.data.orgId, userId: response.data.userId });
      } catch { if (active && generation === requestGeneration) setAccount(null); }
    }
    window.addEventListener(ESTIMATOR_DRAFT_ACCOUNT_EVENT, invalidate);
    window.addEventListener(ESTIMATOR_DRAFT_CLEANUP_EVENT, invalidate);
    window.addEventListener('focus', confirmAccount);
    void confirmAccount();
    return () => { active = false; window.removeEventListener('focus', confirmAccount); window.removeEventListener(ESTIMATOR_DRAFT_ACCOUNT_EVENT, invalidate); window.removeEventListener(ESTIMATOR_DRAFT_CLEANUP_EVENT, invalidate); };
  }, []);

  useEffect(() => {
    installAccountBridge();
    const auth = (event?: Event) => {
      if (event?.type === ESTIMATOR_DRAFT_ACCOUNT_EVENT && accountIdentity(window.CrewmodoEstimatorAccount) === accountId) return;
      state.current.blocked = true;
      state.current.suppressed = true;
      if (accountId) accountChangeCallback.current?.();
      setCandidate(null);
      setAccount(window.CrewmodoEstimatorAccount || null);
      setStatus('Local drafts cleared');
    };
    const storage = (event: StorageEvent) => {
      if (event.key === 'crewmodo.sessionToken') {
        clearEstimatorDrafts();
        window.CrewmodoEstimatorAccount = null;
        auth();
      } else if (event.key === key && event.newValue !== event.oldValue) {
        state.current.blocked = true;
        setStatus('Needs attention: this draft changed in another tab. Reload to review it.');
      }
    };
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener(ESTIMATOR_DRAFT_ACCOUNT_EVENT, auth);
    window.addEventListener(ESTIMATOR_DRAFT_CLEANUP_EVENT, auth);
    window.addEventListener('storage', storage);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    return () => {
      window.removeEventListener(ESTIMATOR_DRAFT_ACCOUNT_EVENT, auth);
      window.removeEventListener(ESTIMATOR_DRAFT_CLEANUP_EVENT, auth);
      window.removeEventListener('storage', storage);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
    };
  }, [key]);

  function flush() {
    const session = state.current;
    if (!session.key || session.blocked || session.suppressed || current.current.serialized === session.saved || current.current.serialized === session.baseline) return;
    try {
      const content = JSON.stringify({ version: 2, savedAt: Date.now(), baseVersion: current.current.baseVersion, value: JSON.parse(current.current.serialized) });
      if (content.length > MAX_DRAFT_BYTES) throw new Error('Draft is too large');
      localStorage.setItem(session.key, content);
      session.saved = current.current.serialized;
      setStatus('Saved locally');
    } catch { setStatus('Needs attention: local recovery is unavailable. Save a server draft.'); }
  }

  useEffect(() => {
    setCandidate(null);
    state.current = { key: enabled ? key : '', blocked: !enabled || !key, baseline: current.current.serialized, saved: '', suppressed: false };
    if (!enabled || !key) return;
    try {
      for (const storedKey of Object.keys(localStorage)) {
        if (!storedKey.startsWith(ESTIMATOR_DRAFT_PREFIX)) continue;
        try {
          const draft = JSON.parse(localStorage.getItem(storedKey) || 'null');
          if (draft?.version !== 2 || !Number.isFinite(draft.savedAt) || Date.now() - draft.savedAt > ESTIMATOR_DRAFT_RETENTION_MS || draft.savedAt > Date.now() + 60_000) localStorage.removeItem(storedKey);
        } catch { localStorage.removeItem(storedKey); }
      }
      const raw = localStorage.getItem(key);
      if (raw && raw.length <= MAX_DRAFT_BYTES) {
        const draft = JSON.parse(raw) as DraftEnvelope<T>;
        if (draft.version === 2 && typeof draft.baseVersion === 'string' && validate(draft.value)) {
          state.current.blocked = true;
          setCandidate(draft);
        } else localStorage.removeItem(key);
      }
    } catch { setStatus('Needs attention: local recovery is unavailable. Save a server draft.'); }
    window.addEventListener('pagehide', flush);
    return () => { flush(); window.removeEventListener('pagehide', flush); };
  }, [key, enabled, estimateKey]);

  useEffect(() => {
    const timer = window.setTimeout(flush, 600);
    return () => window.clearTimeout(timer);
  }, [serialized, key, candidate]);

  function discard() {
    try { if (key) localStorage.removeItem(key); } catch { /* Keep the explicit decision in memory. */ }
    state.current.blocked = false;
    state.current.baseline = current.current.serialized;
    setCandidate(null);
    setStatus('Local draft discarded');
    estimatorEvent('draft_discarded');
  }

  function restore() {
    if (!candidate) return null;
    const recovered = candidate.value;
    state.current.blocked = false;
    state.current.baseline = '';
    state.current.saved = JSON.stringify(recovered);
    setCandidate(null);
    setStatus('Restored locally; not saved to server');
    estimatorEvent('draft_restored', { stale: candidate.baseVersion !== baseVersion });
    return recovered;
  }

  function clearAfterSave({ navigating = false }: { navigating?: boolean } = {}) {
    try { if (key) localStorage.removeItem(key); } catch { /* The server save remains valid. */ }
    state.current.baseline = current.current.serialized;
    state.current.saved = '';
    state.current.suppressed = navigating;
    setCandidate(null);
    setStatus('Saved');
  }

  return { candidate, restore, discard, clearAfterSave, online, available: Boolean(key), status: status || (key ? 'Not saved to server' : 'Local recovery needs confirmed account identity'), conflict: Boolean(candidate && candidate.baseVersion !== baseVersion) };
}
