import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));
vi.mock('../db.js', () => ({ db: { select: mockSelect } }));

import { resolveSurfaces } from '../surfaces/resolve.js';

describe('resolveSurfaces', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only surfaces whose relevantKinds includes the kind', async () => {
    mockSelect.mockReturnValue({
      from: () => Promise.resolve([
        { surfaceId: 'mcp-so', name: 'mcp.so', relevantKinds: ['agent', 'api', 'dev'] },
        { surfaceId: 'npm',    name: 'npm',    relevantKinds: ['lib', 'dev'] },
        { surfaceId: 'pad',    name: 'PAD portals', relevantKinds: ['desktop'] },
      ]),
    });
    const result = await resolveSurfaces('agent');
    const ids = result.map(s => s.surfaceId);
    expect(ids).toContain('mcp-so');
    expect(ids).not.toContain('npm');
    expect(ids).not.toContain('pad');
  });

  it('returns empty when no surface matches the kind', async () => {
    mockSelect.mockReturnValue({
      from: () => Promise.resolve([{ surfaceId: 'pad', name: 'PAD', relevantKinds: ['desktop'] }]),
    });
    expect(await resolveSurfaces('agent')).toEqual([]);
  });

  it('maps a record kind (ai_agent) to the registry kind (agent)', async () => {
    mockSelect.mockReturnValue({
      from: () => Promise.resolve([
        { surfaceId: 'mcp-so', name: 'mcp.so', relevantKinds: ['agent', 'api', 'dev'] },
        { surfaceId: 'pad',    name: 'PAD portals', relevantKinds: ['desktop'] },
      ]),
    });
    const result = await resolveSurfaces('ai_agent');
    const ids = result.map(s => s.surfaceId);
    expect(ids).toContain('mcp-so');     // ai_agent → agent matched mcp.so
    expect(ids).not.toContain('pad');
  });

  it('includes surfaces tagged with the "all" wildcard kind', async () => {
    mockSelect.mockReturnValue({
      from: () => Promise.resolve([
        { surfaceId: 'hn',  name: 'Hacker News', relevantKinds: ['all'] },
        { surfaceId: 'pad', name: 'PAD',         relevantKinds: ['desktop'] },
      ]),
    });
    const ids = (await resolveSurfaces('ai_agent')).map(s => s.surfaceId);
    expect(ids).toContain('hn');     // 'all' matches every kind
    expect(ids).not.toContain('pad');
  });

  it('maps library → lib and desktop_app → desktop', async () => {
    mockSelect.mockReturnValue({
      from: () => Promise.resolve([
        { surfaceId: 'npm', name: 'npm', relevantKinds: ['lib', 'dev'] },
        { surfaceId: 'pad', name: 'PAD portals', relevantKinds: ['desktop'] },
      ]),
    });
    expect((await resolveSurfaces('library')).map(s => s.surfaceId)).toEqual(['npm']);
    expect((await resolveSurfaces('desktop_app')).map(s => s.surfaceId)).toEqual(['pad']);
  });
});
