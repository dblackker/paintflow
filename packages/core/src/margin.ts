export function calculateMargin(budget: number, actualCost: number) {
  if (budget <= 0) return 0;
  return ((budget - actualCost) / budget) * 100;
}

export function canTransitionLead(currentStatus: string, newStatus: string) {
  const transitions: Record<string, string[]> = {
    new: ['contacted', 'lost'],
    contacted: ['estimate_sent', 'lost'],
    estimate_sent: ['won', 'lost'],
    won: [],
    lost: ['new'],
  };
  return transitions[currentStatus]?.includes(newStatus) ?? false;
}
