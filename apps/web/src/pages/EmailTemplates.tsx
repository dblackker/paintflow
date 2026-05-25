import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';

export function EmailTemplates() {
  const templates = [
    { id: '1', name: 'Estimate Sent', subject: 'Your painting estimate is ready', type: 'estimate' },
    { id: '2', name: 'Job Scheduled', subject: 'Your painting project is scheduled', type: 'job' },
    { id: '3', name: 'Invoice Due', subject: 'Payment reminder', type: 'invoice' },
    { id: '4', name: 'Review Request', subject: 'How was your experience?', type: 'review' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Email Templates</h1>
        <Button>New Template</Button>
      </div>
      <div className="grid gap-4">
        {templates.map(template => (
          <Card key={template.id}>
            <CardContent className="p-6">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold">{template.name}</h3>
                  <p className="text-sm text-gray-600">{template.subject}</p>
                  <span className="inline-block mt-2 text-xs bg-gray-100 px-2 py-1 rounded">{template.type}</span>
                </div>
                <Button variant="secondary" size="sm">Edit</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
