import { useParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';

export function Review() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <Card className="max-w-2xl w-full">
        <CardContent className="p-8 text-center">
          <div className="text-6xl mb-4">⭐⭐⭐⭐⭐</div>
          <h1 className="text-3xl font-bold mb-4">How was your experience?</h1>
          <p className="text-gray-600 mb-8">Your feedback helps us improve</p>
          <div className="flex gap-2 justify-center mb-8">
            {[1,2,3,4,5].map(i => (
              <button key={i} className="text-4xl hover:scale-110 transition-transform">⭐</button>
            ))}
          </div>
          <textarea className="w-full p-4 border rounded-lg mb-6" rows={4} placeholder="Tell us about your experience..." />
          <Button className="w-full" size="lg">Submit Review</Button>
        </CardContent>
      </Card>
    </div>
  );
}
