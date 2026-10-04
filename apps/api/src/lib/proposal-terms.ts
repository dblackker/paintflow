import { legalSettingsFromPreferences, readPreferenceObject, type LegalSettings } from './legal-settings';
import { paymentScheduleSettingsFromPreferences, type PaymentScheduleMilestoneSetting } from './payment-schedule';

export type ProposalTerms = {
  legal: LegalSettings;
  paymentTerms: string;
  paymentSchedule: PaymentScheduleMilestoneSetting[];
};

export function currentProposalTerms(settings: { businessHours?: unknown; paymentTerms?: string | null; depositPercent?: string | number | null }): ProposalTerms {
  return {
    legal: legalSettingsFromPreferences(readPreferenceObject(settings.businessHours)),
    paymentTerms: settings.paymentTerms || 'Due on completion',
    paymentSchedule: paymentScheduleSettingsFromPreferences(settings).milestones,
  };
}

export function proposalTerms(value: unknown, settings: Parameters<typeof currentProposalTerms>[0]): ProposalTerms {
  const stored = value as ProposalTerms | null;
  return stored?.legal && Array.isArray(stored.paymentSchedule) ? stored : currentProposalTerms(settings);
}

export function proposalPaymentSettings(terms: ProposalTerms) {
  return { businessHours: { paymentSchedule: { enabled: true, milestones: terms.paymentSchedule } } };
}

export async function proposalTermsVersion(terms: ProposalTerms) {
  // Normalize key order so JSONB storage does not change the reviewed fingerprint.
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(terms))));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
