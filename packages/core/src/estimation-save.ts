export interface EstimationSaveAttempt {
  identity: string;
  key: string;
}

/** Keep the operation identity after a failed/unknown response; callers clear only on success. */
export function estimationSaveAttempt(previous: EstimationSaveAttempt | null, identity: string, createKey: () => string): EstimationSaveAttempt {
  return previous?.identity === identity ? previous : { identity, key: createKey() };
}
