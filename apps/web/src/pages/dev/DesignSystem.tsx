import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';

export function DesignSystem() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold mb-6">Design System</h1>
      
      <Card className="mb-6">
        <CardHeader><h2 className="text-xl font-semibold">Buttons</h2></CardHeader>
        <CardContent className="flex gap-4 flex-wrap">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><h2 className="text-xl font-semibold">Cards</h2></CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <Card key={i}>
              <CardContent className="p-6">
                <h3 className="font-semibold">Card {i}</h3>
                <p className="text-sm text-gray-600 mt-2">Card content goes here</p>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-xl font-semibold">Colors</h2></CardHeader>
        <CardContent className="grid grid-cols-4 gap-4">
          {['bg-blue-600', 'bg-green-600', 'bg-red-600', 'bg-yellow-600', 'bg-purple-600', 'bg-gray-600'].map(color => (
            <div key={color} className={`${color} h-20 rounded-lg`}></div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
