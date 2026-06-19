import type { PresenceAdapter, PresenceResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function parseGitHubRepo(record: any): { owner: string; repo: string } | undefined {
  const url: string | undefined = record?.links?.repository;
  if (!url) return undefined;
  const m = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return undefined;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

export const githubAdapter: PresenceAdapter = {
  // Only the project's OWN repo surface (owned_channel) — not community lists that
  // merely live on GitHub (e.g. "awesome-mcp-servers (GitHub)", an agent_registry),
  // which should fall through to the websearch adapter.
  matches: (s: Surface) => /github/i.test(s.name) && s.surfaceType === 'owned_channel',

  async check(record, surface): Promise<PresenceResult> {
    const base = { surfaceId: surface.surfaceId, surfaceName: surface.name } as const;
    const parsed = parseGitHubRepo(record);
    if (!parsed) {
      return { ...base, state: 'absent', confidence: 'high', notes: 'no github repository link declared' };
    }
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'presence-engine',
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, { headers });
    if (res.status === 200) {
      const data = (await res.json()) as { html_url?: string; topics?: string[]; description?: string };
      const topics = (data.topics ?? []).join(',');
      return {
        ...base,
        state: 'listed',
        confidence: 'high',
        evidenceUrl: data.html_url ?? `https://github.com/${parsed.owner}/${parsed.repo}`,
        notes: `topics:[${topics}] desc:${data.description ?? ''}`,
      };
    }
    if (res.status === 404) return { ...base, state: 'absent', confidence: 'high' };
    return { ...base, state: 'unknown', confidence: 'low', notes: `github returned ${res.status}` };
  },
};
