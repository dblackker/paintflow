import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';

export function EstimatePhotos() {
  const [photos, setPhotos] = useState<Array<{ id: string; url: string; caption: string }>>([]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    // Mock upload
    const newPhotos = Array.from(files).map((file, idx) => ({
      id: Date.now().toString() + idx,
      url: URL.createObjectURL(file),
      caption: file.name,
    }));
    setPhotos([...photos, ...newPhotos]);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <Link to="/estimates/1" className="text-blue-600 hover:text-blue-700 text-sm">← Back to Estimate</Link>
          <h2 className="text-2xl font-bold text-gray-900 mt-2">Project Photos</h2>
          <p className="text-gray-600 mt-1">Upload photos to include with the proposal</p>
        </div>
        <div>
          <label>
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button as="span">Upload Photos</Button>
          </label>
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          {photos.length === 0 ? (
            <EmptyState
              title="No photos yet"
              description="Upload photos to help customers visualize the project scope."
              action={
                <label>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Button as="span" size="sm">Upload Photos</Button>
                </label>
              }
            />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {photos.map((photo) => (
                <div key={photo.id} className="border rounded-lg overflow-hidden">
                  <img src={photo.url} alt={photo.caption} className="w-full h-48 object-cover" />
                  <div className="p-3">
                    <p className="text-sm font-medium truncate">{photo.caption}</p>
                    <Button variant="ghost" size="sm" className="mt-2 text-red-600" onClick={() => setPhotos(photos.filter(p => p.id !== photo.id))}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
