import { add, allocateMinor, decimal, minor, moneyText, ZERO } from '../../../../packages/core/src/estimation-decimal';

type PaymentSettings = {
  depositPercent?: string | number | null;
  paymentTerms?: string | null;
  businessHours?: unknown;
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

export type PaymentScheduleMilestoneSetting = {
  key: string;
  label: string;
  due: string;
  percent: number;
  payable: boolean;
};

export type PaymentScheduleSettings = {
  enabled: boolean;
  milestones: PaymentScheduleMilestoneSetting[];
};

function asPercent(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), 100);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function readPreferenceObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function cleanKey(value: unknown, fallback: string) {
  const raw = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return raw || fallback;
}

function defaultMilestones(settings: PaymentSettings): PaymentScheduleMilestoneSetting[] {
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

export function paymentScheduleSettingsFromPreferences(settings: PaymentSettings): PaymentScheduleSettings {
  const preferences = readPreferenceObject(settings.businessHours);
  const raw = preferences.paymentSchedule && typeof preferences.paymentSchedule === 'object' && !Array.isArray(preferences.paymentSchedule)
    ? preferences.paymentSchedule as Record<string, unknown>
    : {};
  const rawMilestones = Array.isArray(raw.milestones) ? raw.milestones : [];
  const milestones = rawMilestones
    .slice(0, 6)
    .map((item, index) => {
      const rawItem = readPreferenceObject(item);
      const percent = asPercent(rawItem.percent, 0);
      return {
        key: cleanKey(rawItem.key || rawItem.label, `milestone_${index + 1}`),
        label: String(rawItem.label || `Payment ${index + 1}`).trim().slice(0, 80),
        due: String(rawItem.due || 'Due per agreement').trim().slice(0, 160),
        percent,
        payable: Boolean(rawItem.payable),
      };
    })
    .filter((item) => item.label && item.percent > 0);
  const percentTotal = minor(milestones.reduce((sum, item) => add(sum, decimal(item.percent, 'percent', { scale: 20 })), ZERO), 'percent');
  const enabled = Boolean(raw.enabled) && milestones.length > 0 && Math.abs(percentTotal - 10000) <= 1;

  return {
    enabled,
    milestones: enabled ? milestones : defaultMilestones(settings),
  };
}

function baseMilestones(settings: PaymentSettings) {
  const schedule = paymentScheduleSettingsFromPreferences(settings);
  return schedule.milestones;
}

export function estimatePaymentSchedule(settings: PaymentSettings, total: number, paidAmount = 0): EstimatePaymentMilestone[] {
  const totalMinor = minor(decimal(total, 'total', { scale: 20 }), 'total');
  let remainingPaidMinor = Math.max(minor(decimal(paidAmount, 'paidAmount', { signed: true, scale: 20 }), 'paidAmount'), 0);
  const milestones = baseMilestones(settings);
  // Schedule positions break remainder ties and keep duplicate display keys distinct.
  const amounts = allocateMinor(totalMinor, milestones.map((milestone, index) => ({
    id: String(index), weight: decimal(milestone.percent, 'percent', { scale: 20 }),
  })));
  return milestones.map((milestone, index) => {
    const amountMinor = amounts.get(String(index))!;
    const appliedMinor = Math.min(remainingPaidMinor, amountMinor);
    remainingPaidMinor -= appliedMinor;
    const paid = appliedMinor === amountMinor;
    return {
      ...milestone,
      amount: Number(moneyText(amountMinor)),
      paidAmount: Number(moneyText(appliedMinor)),
      status: paid ? 'paid' : milestone.payable ? 'due' : 'upcoming',
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
