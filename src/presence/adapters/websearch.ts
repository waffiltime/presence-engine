import type { PresenceAdapter, PresenceResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

// Scope the search to the surface's own domain when we can derive one.
function surfaceDomain(surface: Surface): string | undefined {
  if (surface.url) {
    try { return new URL(surface.url).hostname; } catch { /* not a URL — fall through */ }
  }
  // Registry names are often the domain itself, e.g. "mcp.so", "smithery.ai".
  const m = surface.name.match(/([a-z0-9-]+\.[a-z]{2,})/i);
  return m ? m[1] : undefined;
}

export const websearchAdapter: PresenceAdapter = {
  matches: () => true, // catch-all — MUST be registered LAST

  async check(record, surface): Promise<PresenceResult> {
    const base = { surfaceId: surface.surfaceId, surfaceName: surface.name } as const;
    const name = record?.subject?.canonical_name ?? record?.subject?.slug ?? '';
    const key = process.env.BRAVE_SEARCH_API_KEY;
    if (!key) {
      return { ...base, state: 'unknown', confidence: 'low', notes: 'no search API key — presence not inferable' };
    }
    const domain = surfaceDomain(surface);
    const q = domain ? `"${name}" site:${domain}` : `"${name}" ${surface.name}`;
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}`,
      { headers: { Accept: 'application/json', 'X-Subscription-Token': key } },
    );
    if (res.status !== 200) {
      return { ...base, state: 'unknown', confidence: 'low', notes: `search returned ${res.status}` };
    }
    const data = (await res.json()) as { web?: { results?: Array<{ url: string }> } };
    const results = data.web?.results ?? [];
    if (results.length > 0) {
      return { ...base, state: 'listed', confidence: 'low', evidenceUrl: results[0].url, notes: `search hit: ${q}` };
    }
    return { ...base, state: 'absent', confidence: 'low', notes: `no search hit: ${q}` };
  },
};
