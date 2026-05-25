import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { Tabs } from '@/components/Tabs';

export function EstimateDetails() {
  const tabItems = [
    { id: 'overview', label: 'Overview' },
    { id: 'line-items', label: 'Line Items' },
    { id: 'terms', label: 'Terms' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      <div className="mb-5">
        <Link to="/estimates/1" className="text-blue-600 hover:text-blue-700 text-sm">← Back to Estimate</Link>
        <h2 className="text-2xl font-bold text-gray-900 mt-2">Estimate Details</h2>
      </div>

      <Card>
        <CardContent className="p-5">
          <Tabs items={tabItems} defaultActive="overview">
            <div id="overview" className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Created</p>
                  <p className="font-medium">Jan 15, 2024</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Last Updated</p>
                  <p className="font-medium">Jan 15, 2024</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Labor Rate</p>
                  <p className="font-medium">$65/hr</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Material Markup</p>
                  <p className="font-medium">30%</p>
                </div>
              </div>
            </div>
            <div id="line-items" className="py-8 text-center text-gray-500">
              Line item details coming soon
            </div>
            <div id="terms" className="py-8 text-center text-gray-500">
              Terms and conditions coming soon
            </div>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
