import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function parseRepo(record: any): { owner: string; repo: string } | undefined {
  const url: string | undefined = record?.links?.repository;
  if (!url) return undefined;
  const m = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return undefined;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

function deriveTopics(record: any): string[] {
  const out = new Set<string>();
  const cat: string | undefined = record?.subject?.category;
  if (cat) for (const w of cat.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) out.add(w);
  for (const k of record?.disambiguation?.must_match_any ?? []) {
    const t = String(k).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (t) out.add(t);
  }
  return [...out].slice(0, 20);
}

export const githubRepoAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'github-repo-about-topics-readme-releases',

  plan(record, _surface): SubmitProposal {
    const parsed = parseRepo(record);
    const payload = {
      owner: parsed?.owner ?? '',
      repo: parsed?.repo ?? '',
      description: record?.positioning?.one_liner ?? '',
      homepage: record?.links?.homepage ?? '',
      topics: deriveTopics(record),
    };
    const preview = parsed
      ? `Update ${payload.owner}/${payload.repo}:\n  description: ${payload.description}\n  homepage: ${payload.homepage}\n  topics: ${payload.topics.join(', ')}`
      : 'No GitHub repository link declared — cannot update.';
    return { mechanism: 'api', payload, preview };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return { outcome: 'failed', notes: 'no GITHUB_TOKEN set — run submit:connect' };
    const { owner, repo, description, homepage, topics } = proposal.payload as {
      owner: string; repo: string; description: string; homepage: string; topics: string[];
    };
    if (!owner || !repo) return { outcome: 'failed', notes: 'no GitHub repository link declared' };

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'presence-engine',
      'Content-Type': 'application/json',
    };
    const patch = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      method: 'PATCH', headers, body: JSON.stringify({ description, homepage }),
    });
    if (patch.status !== 200) return { outcome: 'failed', notes: `GitHub PATCH returned ${patch.status}` };
    const data = (await patch.json()) as { html_url?: string };

    const put = await fetch(`https://api.github.com/repos/${owner}/${repo}/topics`, {
      method: 'PUT', headers, body: JSON.stringify({ names: topics }),
    });
    if (put.status !== 200) return { outcome: 'failed', notes: `GitHub topics PUT returned ${put.status}` };

    return { outcome: 'submitted', evidenceUrl: data.html_url ?? `https://github.com/${owner}/${repo}`, notes: 'updated repo metadata + topics' };
  },
};
