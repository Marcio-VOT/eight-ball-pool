'use client';

import { useSyncExternalStore } from 'react';
import { getSavedNickname, subscribeSavedNickname } from './session';

/**
 * Subscribe cleanly to the persisted player nickname without setState-in-effect.
 */
export function useSavedNickname(fallback = ''): string {
  return useSyncExternalStore(
    subscribeSavedNickname,
    () => {
      const saved = getSavedNickname();
      return saved.length >= 2 ? saved : fallback;
    },
    () => fallback
  );
}
