import { describe, it, expect } from 'vitest';
import { draftAdapter } from '../submit/adapters/draft.js';

const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'mcp server' },
  positioning: { one_liner: 'An example MCP server for discovery.' },
  links: { homepage: 'https://beacon.example.com', repository: 'https://github.com/exampleco/beacon' },
};

describe('draftAdapter', () => {
  it('matches the community/social draft surfaces', () => {
    for (const id of ['hacker-news-show-hn', 'reddit-relevant-subs', 'dev-to', 'lobsters-indie-hackers', 'x-twitter', 'product-hunt']) {
      expect(draftAdapter.matches({ surfaceId: id, name: id } as any)).toBe(true);
    }
  });

  it('does not match owned/third-party submit surfaces', () => {
    expect(draftAdapter.matches({ surfaceId: 'mcp-so', name: 'mcp.so' } as any)).toBe(false);
    expect(draftAdapter.matches({ surfaceId: 'github-repo-about-topics-readme-releases', name: 'GitHub' } as any)).toBe(false);
  });

  it('plan() builds a draft proposal with mechanism draft', () => {
    const p = draftAdapter.plan(record, { surfaceId: 'reddit-relevant-subs', name: 'Reddit (relevant subs)' } as any);
    expect(p.mechanism).toBe('draft');
    expect(String(p.payload.draft)).toContain('Beacon');
    expect(p.preview).toContain('Beacon');
  });

  it('plan() shapes a Show HN title for Hacker News', () => {
    const p = draftAdapter.plan(record, { surfaceId: 'hacker-news-show-hn', name: 'Hacker News (Show HN)' } as any);
    expect(String(p.payload.draft)).toMatch(/^Show HN: Beacon/);
  });

  it('plan() keeps an X/Twitter draft within 280 characters', () => {
    const p = draftAdapter.plan(record, { surfaceId: 'x-twitter', name: 'X / Twitter' } as any);
    expect(String(p.payload.draft).length).toBeLessThanOrEqual(280);
  });

  it('execute() never posts — returns needs_human', async () => {
    const surface = { surfaceId: 'reddit-relevant-subs', name: 'Reddit (relevant subs)' } as any;
    const p = draftAdapter.plan(record, surface);
    const r = await draftAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    expect(r.notes).toMatch(/post it yourself|never/i);
  });
});
