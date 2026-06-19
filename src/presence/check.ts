import type { Surface } from '../surfaces/resolve.js';
import type { PresenceAdapter, PresenceResult } from './types.js';
import { githubAdapter } from './adapters/github.js';
import { npmAdapter } from './adapters/npm.js';
import { pypiAdapter } from './adapters/pypi.js';
import { websearchAdapter } from './adapters/websearch.js';

// websearch is LAST — it matches everything, so specific (high-confidence)
// adapters win. Order among the specific ones is irrelevant; their matchers
// are mutually exclusive.
const ADAPTERS: PresenceAdapter[] = [githubAdapter, npmAdapter, pypiAdapter, websearchAdapter];

export async function checkPresence(record: any, surfaces: Surface[]): Promise<PresenceResult[]> {
  const results: PresenceResult[] = [];
  for (const surface of surfaces) {
    // The registry marks some surfaces Monitor=No (AI answer engines, enterprise
    // registries): not publicly queryable. Checking them anyway produces a
    // confident-looking but bogus verdict, so report 'unknown' honestly — the
    // score excludes 'unknown' rather than counting it as a zero.
    if (surface.monitor === 'no') {
      results.push({
        surfaceId: surface.surfaceId,
        surfaceName: surface.name,
        state: 'unknown',
        confidence: 'low',
        notes: 'not monitorable (registry Monitor=No) — presence not inferable',
      });
      continue;
    }
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
