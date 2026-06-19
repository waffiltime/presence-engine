import type { Surface } from '../surfaces/resolve.js';

export type PresenceState = 'listed' | 'wrong' | 'absent' | 'unknown';

export interface PresenceResult {
  surfaceId: string;
  surfaceName: string;
  state: PresenceState;
  confidence: 'high' | 'low';
  evidenceUrl?: string;
  notes?: string;
}

export interface PresenceAdapter {
  /** does this adapter handle the given surface? */
  matches(surface: Surface): boolean;
  check(record: any, surface: Surface): Promise<PresenceResult>;
}
