import type { PresenceAdapter, PresenceResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

// PyPI's JSON API is authoritative, same model as npm: a HIGH-confidence read,
// but only when the record declares the package name (links.pypi_package).
export const pypiAdapter: PresenceAdapter = {
  matches: (s: Surface) => s.surfaceId === 'pypi',

  async check(record, surface): Promise<PresenceResult> {
    const base = { surfaceId: surface.surfaceId, surfaceName: surface.name } as const;
    const pkg: string | undefined = record?.links?.pypi_package;
    if (!pkg) {
      return { ...base, state: 'absent', confidence: 'high', notes: 'no pypi package name declared' };
    }
    const url = `https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`;
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'presence-engine' } });
    if (res.status === 200) {
      return { ...base, state: 'listed', confidence: 'high', evidenceUrl: `https://pypi.org/project/${pkg}/` };
    }
    if (res.status === 404) return { ...base, state: 'absent', confidence: 'high' };
    return { ...base, state: 'unknown', confidence: 'low', notes: `pypi returned ${res.status}` };
  },
};
