import { ChangeEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/Button';
import { Card, CardContent } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { API_URL, apiJson } from '@/lib/api';

interface EstimatePhoto {
  id: string;
  url: string;
  annotations?: Array<{ text?: string }>;
  createdAt?: string;
}

function caption(photo: EstimatePhoto) {
  return photo.annotations?.find((item) => item.text)?.text || 'Estimate photo';
}

export function EstimatePhotos() {
  const { id } = useParams<{ id: string }>();
  const [photos, setPhotos] = useState<EstimatePhoto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');

  async function loadPhotos() {
    if (!id) return;
    setError('');
    try {
      const payload = await apiJson<{ data?: EstimatePhoto[] }>(`/v1/estimate-photos/${id}`);
      setPhotos(payload.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load photos');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadPhotos();
  }, [id]);

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!id || !files.length) return;
    setIsUploading(true);
    setError('');
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('caption', file.name);
        const response = await fetch(`${API_URL}/v1/estimate-photos/${id}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: formData,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Failed to upload photo');
      }
      window.showToast?.(files.length === 1 ? 'Photo uploaded' : 'Photos uploaded', 'success');
      await loadPhotos();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload photo';
      setError(message);
      window.showToast?.(message, 'error');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  }

  async function removePhoto(photoId: string) {
    try {
      await apiJson(`/v1/estimate-photos/${photoId}`, {
        method: 'DELETE',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      setPhotos((current) => current.filter((photo) => photo.id !== photoId));
      window.showToast?.('Photo removed', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to remove photo', 'error');
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-1 pb-24 sm:px-0">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="pf-copy">Upload contractor-only photos for estimate prep and internal context.</p>
        </div>
        <UploadButton isUploading={isUploading} onChange={handleFileUpload} />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <Card>
        <CardContent>
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading estimate photos...</div>
          ) : photos.length === 0 ? (
            <EmptyState
              title="No estimate photos yet"
              description="Upload photos for internal estimating context. These do not appear on the public proposal."
              action={<UploadButton isUploading={isUploading} onChange={handleFileUpload} size="sm" />}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {photos.map((photo) => (
                <div key={photo.id} className="overflow-hidden rounded-lg border bg-white">
                  <img src={photo.url} alt={caption(photo)} className="h-48 w-full object-cover" loading="lazy" />
                  <div className="p-3">
                    <p className="truncate text-sm font-medium text-gray-950">{caption(photo)}</p>
                    <p className="mt-1 text-xs text-gray-500">{photo.createdAt ? new Date(photo.createdAt).toLocaleDateString() : ''}</p>
                    <Button variant="ghost" size="sm" className="mt-2 -ml-3 text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => void removePhoto(photo.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4">
        <Link to={id ? `/estimates/${id}/details` : '/estimates'} className="btn-text btn-sm inline-flex">
          Estimate record
        </Link>
      </div>
    </div>
  );
}

function UploadButton({ isUploading, onChange, size = 'md' }: { isUploading: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void; size?: 'sm' | 'md' }) {
  return (
    <label className="inline-flex">
      <input
        type="file"
        multiple
        accept="image/*"
        onChange={onChange}
        className="hidden"
        disabled={isUploading}
      />
      <Button as="span" size={size} leftIcon={<Icon name="plus" className="h-4 w-4" />} isLoading={isUploading}>
        Upload photos
      </Button>
    </label>
  );
}
