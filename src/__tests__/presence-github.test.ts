import { describe, it, expect, vi, beforeEach } from 'vitest';
import { githubAdapter } from '../presence/adapters/github.js';

const record = { links: { repository: 'https://github.com/exampleco/beacon' } };
const surface = { surfaceId: 'github-repo', name: 'GitHub repo (About/topics/README/releases)', surfaceType: 'owned_channel' } as any;

describe('githubAdapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('matches only the owned repo surface, not other github-named or non-github surfaces', () => {
    expect(githubAdapter.matches(surface)).toBe(true);
    expect(githubAdapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
    // a community list hosted on GitHub is an agent_registry, not the project's repo → no match
    expect(githubAdapter.matches({ surfaceId: 'awesome', name: 'awesome-mcp-servers (GitHub)', surfaceType: 'agent_registry' } as any)).toBe(false);
  });

  it('listed on HTTP 200, with evidenceUrl and topics in notes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ html_url: 'https://github.com/exampleco/beacon', topics: ['mcp', 'ai-agent'], description: 'router' }),
    }));
    const r = await githubAdapter.check(record, surface);
    expect(r.state).toBe('listed');
    expect(r.confidence).toBe('high');
    expect(r.evidenceUrl).toContain('github.com/exampleco/beacon');
  });

  it('absent on HTTP 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, json: () => Promise.resolve({}) }));
    const r = await githubAdapter.check(record, surface);
    expect(r.state).toBe('absent');
    expect(r.confidence).toBe('high');
  });

  it('absent (high) when the record declares no repository link', async () => {
    const r = await githubAdapter.check({ links: {} }, surface);
    expect(r.state).toBe('absent');
    expect(r.notes).toMatch(/no github/i);
  });

  it('unknown (low) on other status codes (e.g. 403 rate-limit)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 403, json: () => Promise.resolve({}) }));
    const r = await githubAdapter.check(record, surface);
    expect(r.state).toBe('unknown');
    expect(r.confidence).toBe('low');
  });
});
