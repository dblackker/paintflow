import { useRef, useState } from 'react';
import { Camera, Images, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiJson } from '@/lib/api';
import { estimatorEvent } from './estimator-draft';

export function EstimatorRoomPhotos({ estimateId, roomName, onSaveDraft }: { estimateId?: string; roomName: string; onSaveDraft: () => void }) {
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function upload(input: HTMLInputElement) {
    const selected = Array.from(input.files || []);
    if (!estimateId || !selected.length) return;
    setUploading(true); setError(''); setStatus('');
    try {
      for (const file of selected) {
        const body = new FormData();
        body.append('file', file);
        // Editor room IDs are not database room IDs; the existing caption carries context.
        body.append('caption', `${roomName}: ${file.name}`);
        await apiJson(`/v1/estimate-photos/${estimateId}`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body });
      }
      setStatus(`${selected.length} room photo${selected.length === 1 ? '' : 's'} uploaded`);
      estimatorEvent('room_photos_uploaded', { count: selected.length });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Photo upload failed');
    } finally { input.value = ''; setUploading(false); }
  }

  return <div className="space-y-2">
    <input ref={camera} className="hidden" aria-label={`Camera photo for ${roomName}`} type="file" accept="image/*" capture="environment" onChange={(event) => void upload(event.currentTarget)} />
    <input ref={files} className="hidden" aria-label={`Upload photos for ${roomName}`} type="file" accept="image/*" multiple onChange={(event) => void upload(event.currentTarget)} />
    <div className="flex flex-wrap gap-2">
      <button className="btn-secondary min-h-12" disabled={!estimateId || uploading} onClick={() => camera.current?.click()}><Camera className="h-5 w-5" />Take photo</button>
      <button className="btn-secondary min-h-12" disabled={!estimateId || uploading} onClick={() => files.current?.click()}><Upload className="h-5 w-5" />Upload photos</button>
      {estimateId ? <Link className="btn-text min-h-12" to={`/estimates/${estimateId}/photos`}><Images className="h-5 w-5" />Estimate photos</Link> : <button className="btn-text min-h-12" onClick={onSaveDraft}>Save draft</button>}
    </div>
    {!estimateId && <p className="pf-helper">Photos need a saved estimate.</p>}
    {status && <p className="pf-helper" role="status">{status}</p>}
    {error && <p className="pf-field-error" role="alert">{error}</p>}
  </div>;
}
