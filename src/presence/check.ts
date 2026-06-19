import type { Surface } from '../surfaces/resolve.js';
import type { PresenceAdapter, PresenceResult } from './types.js';
import { githubAdapter } from './adapters/github.js';
import { websearchAdapter } from './adapters/websearch.js';

// websearch is LAST — it matches everything, so specific adapters win.
const ADAPTERS: PresenceAdapter[] = [githubAdapter, websearchAdapter];

export async function checkPresence(record: any, surfaces: Surface[]): Promise<PresenceResult[]> {
  const results: PresenceResult[] = [];
  for (const surface of surfaces) {
    const adapter = ADAPTERS.find(a => a.matches(surface));
    if (!adapter) continue;
    try {
      results.push(await adapter.check(record, surface));
    } catch (e: any) {
      results.push({
        surfaceId: surface.surfaceId,
        surfaceName: surface.name,
        state: 'unknown',
        confidence: 'low',
        notes: `check failed: ${e.message}`,
      });
    }
  }
  return results;
}
