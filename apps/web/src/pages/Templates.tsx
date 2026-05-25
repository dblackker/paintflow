import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';

export function Templates() {
  const templates = [
    { id: '1', name: 'Interior Room', type: 'Estimate', items: 8, lastUsed: '2 days ago' },
    { id: '2', name: 'Exterior House', type: 'Estimate', items: 12, lastUsed: '1 week ago' },
    { id: '3', name: 'Cabinet Painting', type: 'Estimate', items: 6, lastUsed: '2 weeks ago' },
    { id: '4', name: 'Deck Staining', type: 'Estimate', items: 5, lastUsed: '1 month ago' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Templates</h1>
        <Button>New Template</Button>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {templates.map(template => (
          <Card key={template.id}>
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold">{template.name}</h3>
                  <p className="text-sm text-gray-600">{template.type} • {template.items} items</p>
                  <p className="text-xs text-gray-500 mt-1">Last used {template.lastUsed}</p>
                </div>
                <Button variant="secondary" size="sm">Use</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
