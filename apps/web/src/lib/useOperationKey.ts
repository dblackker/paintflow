import { useRef } from 'react';

// A lost response must reuse the same key, not become a second financial action.
export function useOperationKey() {
  const attempts = useRef(new Map<string, { body: string; key: string }>());
  return {
    keyFor(action: string, body: string) {
      const current = attempts.current.get(action);
      if (current?.body === body) return current.key;
      const key = crypto.randomUUID();
      attempts.current.set(action, { body, key });
      return key;
    },
    complete(action: string) { attempts.current.delete(action); },
  };
}
