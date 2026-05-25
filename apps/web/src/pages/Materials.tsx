import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';

interface Material {
  id: string;
  name: string;
  supplier: string;
  cost: number;
  unit: string;
  inStock: number;
}

export function Materials() {
  const [materials, setMaterials] = useState<Material[]>([]);

  useEffect(() => {
    setMaterials([
      { id: '1', name: 'Premium Interior Paint', supplier: 'Sherwin-Williams', cost: 6500, unit: 'gallon', inStock: 12 },
      { id: '2', name: 'Caulk', supplier: 'PPG', cost: 850, unit: 'tube', inStock: 48 },
      { id: '3', name: 'Painter\'s Tape', supplier: '3M', cost: 500, unit: 'roll', inStock: 20 },
    ]);
  }, []);

  const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Materials</h1>
        <Button>Add Material</Button>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {materials.map(material => (
          <Card key={material.id}>
            <CardHeader>
              <h3 className="font-semibold">{material.name}</h3>
              <p className="text-sm text-gray-600">{material.supplier}</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm">Cost:</span>
                  <span className="font-medium">{formatMoney(material.cost)}/{material.unit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">In Stock:</span>
                  <span className="font-medium">{material.inStock}</span>
                </div>
                <Button variant="secondary" size="sm" className="w-full mt-4">Edit</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
