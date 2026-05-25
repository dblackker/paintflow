import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/Badge';

export function Reviews() {
  const reviews = [
    { id: '1', customer: 'John Smith', job: 'Exterior Painting', rating: 5, status: 'sent', date: '2 days ago' },
    { id: '2', customer: 'Jane Doe', job: 'Interior Painting', rating: 5, status: 'completed', date: '1 week ago' },
    { id: '3', customer: 'Bob Johnson', job: 'Cabinet Painting', rating: null, status: 'pending', date: 'Just completed' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Reviews</h1>
        <Button>Request Review</Button>
      </div>
      <div className="grid gap-4">
        {reviews.map(review => (
          <Card key={review.id}>
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold">{review.customer}</h3>
                  <p className="text-sm text-gray-600">{review.job}</p>
                  <p className="text-xs text-gray-500 mt-1">{review.date}</p>
                </div>
                <div className="flex items-center gap-4">
                  {review.rating && <span className="text-2xl">{'⭐'.repeat(review.rating)}</span>}
                  <StatusBadge status={review.status} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
