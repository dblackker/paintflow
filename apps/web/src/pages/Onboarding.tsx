import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';

export function Onboarding() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <Card className="max-w-2xl w-full">
        <CardHeader className="text-center">
          <h1 className="text-3xl font-bold">Welcome to PaintFlow!</h1>
          <p className="text-gray-600 mt-2">Let's set up your account in 2 minutes</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <Input label="Company Name" placeholder="Acme Painting" />
            <Input label="Your Name" placeholder="John Smith" />
            <Input label="Phone" placeholder="(555) 123-4567" />
          </div>
          <div className="border-t pt-6">
            <h3 className="font-semibold mb-4">Default Pricing</h3>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Labor Rate ($/hr)" type="number" defaultValue="65" />
              <Input label="Material Markup (%)" type="number" defaultValue="30" />
            </div>
          </div>
          <Button className="w-full" size="lg">Get Started</Button>
        </CardContent>
      </Card>
    </div>
  );
}
