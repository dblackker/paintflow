// Runtime-agnostic business logic
export interface Lead {
  id: string;
  orgId: string;
  name: string;
  status: 'new' | 'contacted' | 'estimate_sent' | 'won' | 'lost';
}

export function canTransitionLead(from: Lead['status'], to: Lead['status']): boolean {
  const transitions: Record<Lead['status'], Lead['status'][]> = {
    new: ['contacted', 'lost'],
    contacted: ['estimate_sent', 'lost'],
    estimate_sent: ['won', 'lost'],
    won: [],
    lost: [],
  };
  return transitions[from].includes(to);
}

export function calculateMargin(invoiceTotal: number, actualCost: number): number {
  if (invoiceTotal === 0) return 0;
  return ((invoiceTotal - actualCost) / invoiceTotal) * 100;
}
