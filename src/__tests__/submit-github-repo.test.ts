import { describe, it, expect, vi, afterEach } from 'vitest';
import { githubRepoAdapter } from '../submit/adapters/github-repo.js';

const surface = { surfaceId: 'github-repo-about-topics-readme-releases', name: 'GitHub repo' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'mcp server' },
  positioning: { one_liner: 'An example MCP server.' },
  links: { homepage: 'https://beacon.example.com', repository: 'https://github.com/exampleco/beacon' },
};

describe('githubRepoAdapter', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('matches only the github repo surface', () => {
    expect(githubRepoAdapter.matches(surface)).toBe(true);
    expect(githubRepoAdapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
  });

  it('plan() builds an api payload with description, homepage, and parsed owner/repo', () => {
    const p = githubRepoAdapter.plan(record, surface);
    expect(p.mechanism).toBe('api');
    expect(p.payload.owner).toBe('exampleco');
    expect(p.payload.repo).toBe('beacon');
    expect(p.payload.description).toBe('An example MCP server.');
    expect(p.payload.homepage).toBe('https://beacon.example.com');
    expect(p.preview).toContain('exampleco/beacon');
  });

  it('execute() without GITHUB_TOKEN returns failed', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const p = githubRepoAdapter.plan(record, surface);
    const r = await githubRepoAdapter.execute(p, surface);
    expect(r.outcome).toBe('failed');
    expect(r.notes).toMatch(/GITHUB_TOKEN/);
  });

  it('execute() PATCHes metadata + PUTs topics and returns submitted on success', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'tok');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 200, json: () => Promise.resolve({ html_url: 'https://github.com/exampleco/beacon' }) })
      .mockResolvedValueOnce({ status: 200, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    const p = githubRepoAdapter.plan(record, surface);
    const r = await githubRepoAdapter.execute(p, surface);
    expect(r.outcome).toBe('submitted');
    expect(r.evidenceUrl).toBe('https://github.com/exampleco/beacon');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('execute() returns failed when the GitHub API errors', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 403, json: () => Promise.resolve({}) }));
    const p = githubRepoAdapter.plan(record, surface);
    const r = await githubRepoAdapter.execute(p, surface);
    expect(r.outcome).toBe('failed');
  });
});
