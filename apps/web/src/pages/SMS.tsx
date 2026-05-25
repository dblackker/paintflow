import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';

export function SMS() {
  const [conversations] = useState([
    { id: '1', name: 'John Smith', phone: '(206) 555-0100', lastMessage: 'Thanks for the estimate!', time: '2h ago', unread: true },
    { id: '2', name: 'Jane Doe', phone: '(425) 555-0200', lastMessage: 'When can you start?', time: '5h ago', unread: false },
  ]);
  const [selectedId, setSelectedId] = useState('1');

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-5">Messages</h2>
      
      <div className="grid lg:grid-cols-[320px_1fr] gap-5 h-[600px]">
        <Card className="overflow-hidden">
          <CardHeader title="Conversations" />
          <CardContent className="p-0 overflow-y-auto h-full">
            {conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                className={`w-full text-left p-4 border-b hover:bg-gray-50 ${selectedId === conv.id ? 'bg-blue-50' : ''}`}
              >
                <div className="flex justify-between mb-1">
                  <span className="font-medium text-sm">{conv.name}</span>
                  <span className="text-xs text-gray-500">{conv.time}</span>
                </div>
                <p className="text-xs text-gray-600 truncate">{conv.lastMessage}</p>
                {conv.unread && <span className="inline-block w-2 h-2 bg-blue-600 rounded-full mt-1"></span>}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader title={conversations.find(c => c.id === selectedId)?.name} />
          <CardContent className="flex-1 flex flex-col p-0">
            <div className="flex-1 p-4 space-y-3 overflow-y-auto">
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-lg px-4 py-2 max-w-[70%]">
                  <p className="text-sm">Hi, I got the estimate. Can we schedule?</p>
                </div>
              </div>
              <div className="flex justify-end">
                <div className="bg-blue-600 text-white rounded-lg px-4 py-2 max-w-[70%]">
                  <p className="text-sm">Yes! We can start next week. Does Monday work?</p>
                </div>
              </div>
            </div>
            <div className="p-4 border-t">
              <div className="flex gap-2">
                <Textarea placeholder="Type a message..." rows={2} className="flex-1" />
                <Button size="sm">Send</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
