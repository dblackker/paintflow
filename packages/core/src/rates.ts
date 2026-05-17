export interface ProductionRate {
  task: string;
  unit: 'sqft' | 'linear_ft' | 'each' | 'hour';
  rate: number; // units per hour
  category: 'prep' | 'paint' | 'trim' | 'cabinet';
}

export const PRODUCTION_RATES: ProductionRate[] = [
  // Prep
  { task: 'Mask and cover floors', unit: 'sqft', rate: 300, category: 'prep' },
  { task: 'Patch small holes', unit: 'each', rate: 20, category: 'prep' },
  { task: 'Caulk trim', unit: 'linear_ft', rate: 60, category: 'prep' },
  { task: 'Sand surfaces', unit: 'sqft', rate: 200, category: 'prep' },
  
  // Interior paint
  { task: 'Paint walls (2 coats)', unit: 'sqft', rate: 150, category: 'paint' },
  { task: 'Paint ceiling (2 coats)', unit: 'sqft', rate: 120, category: 'paint' },
  { task: 'Paint trim (2 coats)', unit: 'linear_ft', rate: 40, category: 'trim' },
  { task: 'Paint doors (2 coats)', unit: 'each', rate: 4, category: 'trim' },
  
  // Exterior paint
  { task: 'Paint siding (2 coats)', unit: 'sqft', rate: 100, category: 'paint' },
  { task: 'Paint eaves/soffits', unit: 'linear_ft', rate: 30, category: 'trim' },
  { task: 'Pressure wash', unit: 'sqft', rate: 800, category: 'prep' },
  
  // Cabinets
  { task: 'Paint cabinet doors (spray)', unit: 'each', rate: 8, category: 'cabinet' },
  { task: 'Paint cabinet boxes', unit: 'each', rate: 6, category: 'cabinet' },
];

export function calculateLaborHours(task: string, quantity: number): number {
  const rate = PRODUCTION_RATES.find(r => r.task.toLowerCase().includes(task.toLowerCase()));
  if (!rate) return 0;
  return quantity / rate.rate;
}

export function estimateJob(tasks: Array<{ task: string; quantity: number; hourlyRate: number }>) {
  const breakdown = tasks.map(t => {
    const hours = calculateLaborHours(t.task, t.quantity);
    const laborCost = hours * t.hourlyRate;
    return { ...t, hours, laborCost };
  });
  
  const totalHours = breakdown.reduce((sum, t) => sum + t.hours, 0);
  const totalLabor = breakdown.reduce((sum, t) => sum + t.laborCost, 0);
  
  return { breakdown, totalHours, totalLabor };
}
