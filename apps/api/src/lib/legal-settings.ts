export type LegalSettings = {
  jurisdiction: string;
  contractorRegistrationNumber: string;
  bondAmount: string;
  contractTerms: string;
  disclosureEnabled: boolean;
  disclosureRequired: boolean;
  disclosureTitle: string;
  disclosureText: string;
  legalReviewNote: string;
};

const defaultContractTerms = [
  'Scope of Work: Contractor agrees to perform the painting services described in this proposal using professional practices and selected materials.',
  'Payment Terms: Customer agrees to the payment schedule shown on this proposal. Late or missed payments may delay scheduling or production.',
  'Change Orders: Changes to scope, products, colors, access, or schedule must be approved in writing and may affect price and timing.',
  'Warranty: Workmanship warranty and manufacturer material warranties apply according to contractor policy and product terms.',
  'Access: Customer agrees to provide reasonable access to the property and work areas during scheduled work periods.',
].join('\n\n');

export function readPreferenceObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function legalSettingsFromPreferences(preferences: Record<string, unknown>): LegalSettings {
  const raw = preferences.legal && typeof preferences.legal === 'object' && !Array.isArray(preferences.legal)
    ? preferences.legal as Record<string, unknown>
    : {};

  return {
    jurisdiction: String(raw.jurisdiction || ''),
    contractorRegistrationNumber: String(raw.contractorRegistrationNumber || ''),
    bondAmount: String(raw.bondAmount || ''),
    contractTerms: String(raw.contractTerms || defaultContractTerms),
    disclosureEnabled: Boolean(raw.disclosureEnabled),
    disclosureRequired: Boolean(raw.disclosureRequired),
    disclosureTitle: String(raw.disclosureTitle || 'Required disclosure'),
    disclosureText: String(raw.disclosureText || ''),
    legalReviewNote: String(raw.legalReviewNote || 'Contract terms and statutory disclosures should be reviewed by the contractor attorney before use.'),
  };
}
