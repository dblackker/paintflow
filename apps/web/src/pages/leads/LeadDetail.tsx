import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/Tabs';

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold">John Smith</h1>
          <p className="text-gray-600 mt-1">(206) 555-0100 • john@example.com</p>
          <div className="flex gap-2 mt-3">
            <Badge>New Lead</Badge>
            <Badge variant="info">Residential</Badge>
          </div>
        </div>
        <Button>Create Estimate</Button>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="estimates">Estimates</TabsTrigger>
        </TabsList>
        
        <TabsContent value="details">
          <Card>
            <CardHeader><h2 className="text-xl font-semibold">Contact Information</h2></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Address</p>
                  <p className="font-medium">123 Main St, Seattle, WA 98101</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Source</p>
                  <p className="font-medium">Google Ads</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Project Type</p>
                  <p className="font-medium">Interior Painting</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Budget Range</p>
                  <p className="font-medium">$3,000 - $5,000</p>
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-600">Notes</p>
                <p className="mt-1">Customer wants 3 bedrooms painted. Mentioned they need it done before moving in next month.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="activity">
          <Card>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="w-2 h-2 bg-blue-600 rounded-full mt-2"></div>
                  <div>
                    <p className="font-medium">Lead created</p>
                    <p className="text-sm text-gray-600">2 days ago via website form</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-2 h-2 bg-gray-300 rounded-full mt-2"></div>
                  <div>
                    <p className="font-medium">Called customer</p>
                    <p className="text-sm text-gray-600">Yesterday - Left voicemail</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="estimates">
          <Card>
            <CardContent className="p-12 text-center">
              <p className="text-gray-600">No estimates yet</p>
              <Button className="mt-4">Create Estimate</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
