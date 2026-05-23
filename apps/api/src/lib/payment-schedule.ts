type PaymentSettings = {
  depositPercent?: string | number | null;
  paymentTerms?: string | null;
};

export type EstimatePaymentMilestone = {
  key: string;
  label: string;
  due: string;
  percent: number;
  amount: number;
  paidAmount: number;
  status: 'paid' | 'due' | 'upcoming';
  payable: boolean;
};

function asPercent(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), 100);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function baseMilestones(settings: PaymentSettings) {
  const depositPercent = asPercent(settings.depositPercent, 50);
  const terms = String(settings.paymentTerms || '').toLowerCase();
  const hasProgressPayment = /progress|prep|start|milestone|draw/.test(terms);
  const requiresDeposit = depositPercent > 0;

  if (!requiresDeposit) {
    return [
      { key: 'completion', label: 'Final payment', due: 'Due on completion', percent: 100, payable: true },
    ];
  }

  const remaining = roundMoney(100 - depositPercent);
  if (hasProgressPayment && remaining > 0) {
    const progressPercent = roundMoney(remaining / 2);
    const finalPercent = roundMoney(100 - depositPercent - progressPercent);
    return [
      { key: 'deposit', label: 'Deposit', due: 'Due after approval to reserve the schedule', percent: depositPercent, payable: true },
      { key: 'progress', label: 'Progress payment', due: 'Due before production starts or after prep', percent: progressPercent, payable: false },
      { key: 'completion', label: 'Final payment', due: 'Due on completion', percent: finalPercent, payable: false },
    ];
  }

  return [
    { key: 'deposit', label: 'Deposit', due: 'Due after approval to reserve the schedule', percent: depositPercent, payable: true },
    { key: 'completion', label: 'Final payment', due: 'Due on completion', percent: remaining, payable: false },
  ].filter((item) => item.percent > 0);
}

export function estimatePaymentSchedule(settings: PaymentSettings, total: number, paidAmount = 0): EstimatePaymentMilestone[] {
  let remainingPaid = Math.max(Number(paidAmount) || 0, 0);
  return baseMilestones(settings).map((milestone, index) => {
    const amount = roundMoney(total * (milestone.percent / 100));
    const applied = Math.min(remainingPaid, amount);
    remainingPaid = roundMoney(remainingPaid - applied);
    const paid = applied >= amount - 0.01;
    const previousPaid = index === 0 || remainingPaid >= 0;
    return {
      ...milestone,
      amount,
      paidAmount: applied,
      status: paid ? 'paid' : previousPaid && milestone.payable ? 'due' : 'upcoming',
    };
  });
}

export function nextPayableMilestone(schedule: EstimatePaymentMilestone[], requestedKey?: string | null) {
  if (requestedKey) {
    const requested = schedule.find((milestone) => milestone.key === requestedKey && milestone.payable && milestone.status !== 'paid');
    if (requested) return requested;
  }
  return schedule.find((milestone) => milestone.payable && milestone.status !== 'paid') || null;
}
