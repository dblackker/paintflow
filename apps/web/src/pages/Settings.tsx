import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/Tabs';

export function Settings() {
  const [companyName, setCompanyName] = useState('PaintFlow Painting Co');
  const [email, setEmail] = useState('hello@paintflow.com');
  const [phone, setPhone] = useState('(555) 123-4567');
  const [laborRate, setLaborRate] = useState('65');
  const [markup, setMarkup] = useState('30');
  const [taxRate, setTaxRate] = useState('9.2');

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold mb-6">Settings</h1>
      
      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
        </TabsList>
        
        <TabsContent value="company">
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">Company Information</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input label="Company Name" value={companyName} onChange={e => setCompanyName(e.target.value)} />
              <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
              <Input label="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
              <Button>Save Changes</Button>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="pricing">
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">Default Pricing</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input label="Labor Rate ($/hr)" type="number" value={laborRate} onChange={e => setLaborRate(e.target.value)} />
              <Input label="Material Markup (%)" type="number" value={markup} onChange={e => setMarkup(e.target.value)} />
              <Input label="Sales Tax Rate (%)" type="number" value={taxRate} onChange={e => setTaxRate(e.target.value)} />
              <Button>Save Changes</Button>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="integrations">
          <div className="space-y-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold">Stripe</h3>
                    <p className="text-sm text-gray-600">Accept credit cards and ACH payments</p>
                  </div>
                  <Button variant="secondary">Connect</Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold">QuickBooks</h3>
                    <p className="text-sm text-gray-600">Sync invoices and payments</p>
                  </div>
                  <Button variant="secondary">Connect</Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold">Google Calendar</h3>
                    <p className="text-sm text-gray-600">Two-way calendar sync</p>
                  </div>
                  <Button variant="secondary">Connect</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="team">
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">Team Members</h2>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">Manage team access and permissions</p>
              <Button>Add Team Member</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
