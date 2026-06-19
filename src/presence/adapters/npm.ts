import type { PresenceAdapter, PresenceResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

// The npm registry is authoritative: a package either exists or it doesn't.
// So unlike the web-search fallback, this is a HIGH-confidence read — but only
// when the record actually declares the package name (links.npm_package).
export const npmAdapter: PresenceAdapter = {
  matches: (s: Surface) => s.surfaceId === 'npm',

  async check(record, surface): Promise<PresenceResult> {
    const base = { surfaceId: surface.surfaceId, surfaceName: surface.name } as const;
    const pkg: string | undefined = record?.links?.npm_package;
    if (!pkg) {
      return { ...base, state: 'absent', confidence: 'high', notes: 'no npm package name declared' };
    }
    const url = `https://registry.npmjs.org/${encodeURIComponent(pkg)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'presence-engine' } });
    if (res.status === 200) {
      return { ...base, state: 'listed', confidence: 'high', evidenceUrl: `https://www.npmjs.com/package/${pkg}` };
    }
    if (res.status === 404) return { ...base, state: 'absent', confidence: 'high' };
    return { ...base, state: 'unknown', confidence: 'low', notes: `npm registry returned ${res.status}` };
  },
};
