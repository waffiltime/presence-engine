import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ghCheck, wsCheck } = vi.hoisted(() => ({ ghCheck: vi.fn(), wsCheck: vi.fn() }));
vi.mock('../presence/adapters/github.js', () => ({
  githubAdapter: { matches: (s: any) => /github/i.test(s.name), check: ghCheck },
}));
vi.mock('../presence/adapters/websearch.js', () => ({
  websearchAdapter: { matches: () => true, check: wsCheck },
}));

import { checkPresence } from '../presence/check.js';

describe('checkPresence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes each surface to the first matching adapter (github before websearch)', async () => {
    ghCheck.mockResolvedValue({ surfaceId: 'gh', surfaceName: 'GitHub', state: 'listed', confidence: 'high' });
    wsCheck.mockResolvedValue({ surfaceId: 'mcp', surfaceName: 'mcp.so', state: 'absent', confidence: 'low' });
    const surfaces = [
      { surfaceId: 'gh', name: 'GitHub repo' },
      { surfaceId: 'mcp', name: 'mcp.so' },
    ];
    const results = await checkPresence({}, surfaces as any);
    expect(results).toHaveLength(2);
    expect(ghCheck).toHaveBeenCalledTimes(1);   // github surface → github adapter
    expect(wsCheck).toHaveBeenCalledTimes(1);   // non-github surface → websearch
  });

  it('short-circuits an un-monitorable surface (monitor=no) to unknown without calling any adapter', async () => {
    const surfaces = [{ surfaceId: 'ai', name: 'AI answer engines', monitor: 'no' }];
    const results = await checkPresence({}, surfaces as any);
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe('unknown');
    expect(results[0].confidence).toBe('low');
    expect(ghCheck).not.toHaveBeenCalled();
    expect(wsCheck).not.toHaveBeenCalled();
  });

  it('captures an adapter error as an unknown/low result instead of throwing', async () => {
    ghCheck.mockRejectedValue(new Error('boom'));
    const results = await checkPresence({}, [{ surfaceId: 'gh', name: 'GitHub repo' }] as any);
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe('unknown');
    expect(results[0].confidence).toBe('low');
    expect(results[0].notes).toMatch(/boom/);
  });
});
