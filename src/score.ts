import type { PresenceResult } from './presence/types.js';
import type { Surface } from './surfaces/resolve.js';

const PRIORITY_WEIGHT: Record<string, number> = { P1: 3, P2: 2, P3: 1 };
const STATE_SCORE: Record<string, number> = { listed: 1, wrong: 0.5, absent: 0 };

export function coverageScore(results: PresenceResult[], surfaces: Surface[]): number {
  const weightOf = (id: string) =>
    PRIORITY_WEIGHT[surfaces.find(s => s.surfaceId === id)?.buildPriority ?? 'P3'] ?? 1;
  let num = 0, den = 0;
  for (const r of results) {
    if (r.state === 'unknown') continue;          // not counted either way
    const w = weightOf(r.surfaceId);
    num += w * (STATE_SCORE[r.state] ?? 0);
    den += w;
  }
  return den === 0 ? 0 : Math.round((num / den) * 100);
}
