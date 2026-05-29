import type { orgSettings } from '@paintflow/db/schema';
import { readPreferenceObject } from './legal-settings';

export const FEATURE_FLAG_DEFINITIONS = {
  customerColorSelection: {
    key: 'customerColorSelection',
    label: 'Customer color selection',
    description: 'Lets customers choose paint colors from the public proposal link and surfaces job readiness warnings for missing colors.',
    defaultValue: true,
  },
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAG_DEFINITIONS;
export type FeatureFlagState = Record<FeatureFlagKey, boolean>;

export function defaultFeatureFlags(): FeatureFlagState {
  return Object.fromEntries(
    Object.entries(FEATURE_FLAG_DEFINITIONS).map(([key, definition]) => [key, definition.defaultValue]),
  ) as FeatureFlagState;
}

export function featureFlagsFromPreferences(preferences: Record<string, unknown>): FeatureFlagState {
  const raw = preferences.featureFlags && typeof preferences.featureFlags === 'object' && !Array.isArray(preferences.featureFlags)
    ? preferences.featureFlags as Record<string, unknown>
    : {};
  const defaults = defaultFeatureFlags();
  return Object.fromEntries(
    Object.keys(FEATURE_FLAG_DEFINITIONS).map((key) => [key, typeof raw[key] === 'boolean' ? raw[key] : defaults[key as FeatureFlagKey]]),
  ) as FeatureFlagState;
}

export function featureFlagsFromSettings(settings?: Pick<typeof orgSettings.$inferSelect, 'businessHours'> | null): FeatureFlagState {
  return featureFlagsFromPreferences(readPreferenceObject(settings?.businessHours));
}

export function isFeatureEnabled(settings: Pick<typeof orgSettings.$inferSelect, 'businessHours'> | null | undefined, key: FeatureFlagKey) {
  return featureFlagsFromSettings(settings)[key];
}

export function featureFlagPayload(settings?: Pick<typeof orgSettings.$inferSelect, 'businessHours'> | null) {
  const flags = featureFlagsFromSettings(settings);
  return {
    flags,
    definitions: Object.values(FEATURE_FLAG_DEFINITIONS).map((definition) => ({
      key: definition.key,
      label: definition.label,
      description: definition.description,
      defaultValue: definition.defaultValue,
      enabled: flags[definition.key],
    })),
  };
}
