import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { API_URL } from '@/lib/api';
import { supplierErrorMessage, supplierResponse } from './client';

export function SupplierFileLink({ path, label = 'View file' }: { path: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  let href: string | undefined;
  try {
    const url = new URL(path, `${API_URL}/`);
    if (url.origin === new URL(API_URL).origin && url.pathname.startsWith('/v1/invoices/')) href = url.href;
  } catch { /* Do not offer untrusted or malformed retained-file destinations. */ }

  async function openFile() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      if (!tab) throw new Error('Allow pop-ups to view the invoice file, then try again.');
      const response = await supplierResponse(path);
      const blob = await response.blob();
      if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(blob.type.split(';')[0])) {
        throw new Error('The saved file cannot be previewed. Contact support.');
      }
      const objectUrl = URL.createObjectURL(blob);
      tab.location.replace(objectUrl);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err) {
      tab?.close();
      setError(supplierErrorMessage(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <div className="min-w-0">
    <Button as="a" href={href} target="_blank" rel="noreferrer" variant="ghost" disabled={!href}
      className="!min-h-12 !min-w-12" isLoading={busy} leftIcon={<Icon name="file-text" />}
      onClick={(event) => { event.preventDefault(); void openFile(); }}>{label}</Button>
    {error && <p className="pf-field-error" role="alert">{error}</p>}
  </div>;
}
