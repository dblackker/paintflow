import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';

interface Activity {
  id: string;
  type: string;
  title: string;
  description: string;
  timestamp: string;
  user: { name: string; avatar?: string };
}

export function Activity() {
  const [activities, setActivities] = useState<Activity[]>([]);

  useEffect(() => {
    setActivities([
      { id: '1', type: 'estimate_approved', title: 'Estimate Approved', description: 'John Smith approved estimate #1024', timestamp: '2 hours ago', user: { name: 'John Smith' } },
      { id: '2', type: 'payment_received', title: 'Payment Received', description: '$2,500 payment received from Jane Doe', timestamp: '5 hours ago', user: { name: 'Jane Doe' } },
      { id: '3', type: 'job_completed', title: 'Job Completed', description: 'Exterior painting at 123 Main St finished', timestamp: '1 day ago', user: { name: 'Mike Chen' } },
      { id: '4', type: 'lead_created', title: 'New Lead', description: 'Bob Johnson requested a quote', timestamp: '2 days ago', user: { name: 'Bob Johnson' } },
    ]);
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold mb-6">Activity Feed</h1>
      <div className="space-y-4">
        {activities.map(activity => (
          <Card key={activity.id}>
            <CardContent className="p-6">
              <div className="flex gap-4">
                <Avatar name={activity.user.name} src={activity.user.avatar} />
                <div className="flex-1">
                  <h3 className="font-semibold">{activity.title}</h3>
                  <p className="text-gray-600">{activity.description}</p>
                  <p className="text-sm text-gray-500 mt-2">{activity.timestamp}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
