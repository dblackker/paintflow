import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';

interface Notification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    setNotifications([
      { id: '1', title: 'Estimate Approved', message: 'John Smith approved estimate #1024', timestamp: '2 hours ago', read: false },
      { id: '2', title: 'Payment Received', message: 'Jane Doe paid $2,500', timestamp: '5 hours ago', read: false },
      { id: '3', title: 'Job Scheduled', message: 'Exterior painting scheduled for Feb 20', timestamp: '1 day ago', read: true },
    ]);
  }, []);

  const markAsRead = (id: string) => {
    setNotifications(notifications.map(n => n.id === id ? { ...n, read: true } : n));
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold mb-6">Notifications</h1>
      <div className="space-y-4">
        {notifications.map(notification => (
          <Card key={notification.id} className={notification.read ? 'opacity-60' : ''}>
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="font-semibold">{notification.title}</h3>
                  <p className="text-gray-600">{notification.message}</p>
                  <p className="text-sm text-gray-500 mt-2">{notification.timestamp}</p>
                </div>
                {!notification.read && (
                  <Button variant="ghost" size="sm" onClick={() => markAsRead(notification.id)}>Mark read</Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
