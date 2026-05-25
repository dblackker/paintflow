import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';

interface ProductionItem {
  id: string;
  area: string;
  surface: string;
  paintType: string;
  sqft: number;
  productionRate: number; // sqft per hour
  hours: number;
}

export function EstimateProduction() {
  const [items, setItems] = useState<ProductionItem[]>([
    { id: '1', area: 'Living Room', surface: 'Walls', paintType: 'Eggshell', sqft: 450, productionRate: 100, hours: 4.5 },
    { id: '2', area: 'Living Room', surface: 'Ceiling', paintType: 'Flat', sqft: 225, productionRate: 80, hours: 2.8 },
  ]);

  const addItem = () => {
    setItems([...items, {
      id: Date.now().toString(),
      area: '',
      surface: 'Walls',
      paintType: 'Eggshell',
      sqft: 0,
      productionRate: 100,
      hours: 0,
    }]);
  };

  const updateItem = (id: string, field: keyof ProductionItem, value: any) => {
    setItems(items.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        if (field === 'sqft' || field === 'productionRate') {
          updated.hours = updated.sqft / (updated.productionRate || 1);
        }
        return updated;
      }
      return item;
    }));
  };

  const totalHours = items.reduce((sum, item) => sum + item.hours, 0);
  const totalSqft = items.reduce((sum, item) => sum + item.sqft, 0);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Production Estimator</h2>
          <p className="text-gray-600 mt-1">Calculate labor hours based on production rates</p>
        </div>
        <div className="flex gap-2">
          <Link to="/estimates/new">
            <Button variant="secondary" size="sm">Quick Estimate</Button>
          </Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-5">
        <section>
          <Card>
            <CardHeader title="Production Items">
              <Button size="sm" onClick={addItem}>Add Item</Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.id} className="grid sm:grid-cols-[1.5fr_1fr_1fr_100px_100px_80px] gap-2 items-end border rounded-lg p-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Area</label>
                      <Input
                        value={item.area}
                        onChange={(e) => updateItem(item.id, 'area', e.target.value)}
                        placeholder="Room name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Surface</label>
                      <Select
                        value={item.surface}
                        onChange={(e) => updateItem(item.id, 'surface', e.target.value)}
                      >
                        <option>Walls</option>
                        <option>Ceiling</option>
                        <option>Trim</option>
                        <option>Doors</option>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Paint Type</label>
                      <Select
                        value={item.paintType}
                        onChange={(e) => updateItem(item.id, 'paintType', e.target.value)}
                      >
                        <option>Flat</option>
                        <option>Eggshell</option>
                        <option>Satin</option>
                        <option>Semi-gloss</option>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Sq Ft</label>
                      <Input
                        type="number"
                        value={item.sqft}
                        onChange={(e) => updateItem(item.id, 'sqft', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Rate (sqft/hr)</label>
                      <Input
                        type="number"
                        value={item.productionRate}
                        onChange={(e) => updateItem(item.id, 'productionRate', parseFloat(e.target.value) || 1)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Hours</label>
                      <Input
                        type="number"
                        value={item.hours.toFixed(1)}
                        readOnly
                        className="bg-gray-50"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-4">
          <Card>
            <CardHeader title="Summary" />
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Sq Ft</span>
                  <span className="font-medium">{totalSqft.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Hours</span>
                  <span className="font-medium">{totalHours.toFixed(1)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t">
                  <span className="text-gray-600">Labor Cost</span>
                  <span className="font-medium">${(totalHours * 65).toFixed(2)}</span>
                </div>
              </div>
              <Button fullWidth className="mt-4">Create Estimate from Production</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Production Rates Reference" />
            <CardContent>
              <div className="text-xs space-y-1 text-gray-600">
                <div className="flex justify-between"><span>Walls (Eggshell)</span><span>100 sqft/hr</span></div>
                <div className="flex justify-between"><span>Ceiling (Flat)</span><span>80 sqft/hr</span></div>
                <div className="flex justify-between"><span>Trim (Semi-gloss)</span><span>40 ln ft/hr</span></div>
                <div className="flex justify-between"><span>Doors</span><span>0.5 hr/door</span></div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
