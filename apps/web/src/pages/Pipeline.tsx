import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { StatCard } from '@/components/StatCard';

export function Pipeline() {
  const stages = [
    { name: 'New Leads', count: 12, value: 45000 },
    { name: 'Quoted', count: 8, value: 38000 },
    { name: 'Negotiating', count: 5, value: 22000 },
    { name: 'Won', count: 3, value: 18000 },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold mb-6">Sales Pipeline</h1>
      <div className="grid md:grid-cols-4 gap-4 mb-8">
        {stages.map(stage => (
          <StatCard key={stage.name} title={stage.name} value={`${stage.count} leads`} subtitle={`$${(stage.value/1000).toFixed(0)}k`} />
        ))}
      </div>
      <div className="grid md:grid-cols-4 gap-4">
        {stages.map(stage => (
          <Card key={stage.name}>
            <CardHeader>
              <h3 className="font-semibold">{stage.name}</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Array.from({ length: Math.min(stage.count, 5) }).map((_, i) => (
                  <div key={i} className="p-3 bg-gray-50 rounded-lg">
                    <p className="font-medium text-sm">Lead #{i+1}</p>
                    <p className="text-xs text-gray-600">$3,500 estimate</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
