import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockStream } = vi.hoisted(() => ({ mockStream: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { stream: mockStream }; },
}));

import { buildReport } from '../report.js';

describe('buildReport', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
  afterEach(() => vi.unstubAllEnvs());

  it('empty presence → empty-state report, no API call', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const r = await buildReport('Beacon', 0, []);
    expect(r.score).toBe(0);
    expect(r.actionPoints).toEqual([]);
    expect(r.summary).toMatch(/no surfaces/i);
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('no API key → deterministic templated fallback, no API call', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const presence = [
      { surfaceId: 'a', surfaceName: 'mcp.so', state: 'absent', confidence: 'low' },
      { surfaceId: 'b', surfaceName: 'GitHub', state: 'listed', confidence: 'high' },
    ];
    const r = await buildReport('Beacon', 50, presence as any);
    expect(mockStream).not.toHaveBeenCalled();
    expect(r.score).toBe(50);
    expect(r.actionPoints.length).toBe(1);        // one per absent surface
    expect(r.actionPoints[0].surfaceId).toBe('a');
  });

  it('with API key → calls Sonnet and parses the JSON response', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    mockStream.mockReturnValue({
      finalMessage: () => Promise.resolve({
        content: [{ type: 'text', text: JSON.stringify({ summary: 'ok', actionPoints: [{ surfaceId: 'a', action: 'list it', priority: 'high' }] }) }],
      }),
    });
    const presence = [{ surfaceId: 'a', surfaceName: 'mcp.so', state: 'absent', confidence: 'low' }];
    const r = await buildReport('Beacon', 50, presence as any);
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(r.summary).toBe('ok');
    expect(r.actionPoints[0].surfaceId).toBe('a');
  });

  it('LLM returns unparseable text → falls back to templated report', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    mockStream.mockReturnValue({
      finalMessage: () => Promise.resolve({ content: [{ type: 'text', text: 'not json at all' }] }),
    });
    const presence = [{ surfaceId: 'a', surfaceName: 'mcp.so', state: 'absent', confidence: 'low' }];
    const r = await buildReport('Beacon', 50, presence as any);
    expect(r.score).toBe(50);
    expect(r.actionPoints[0].surfaceId).toBe('a');  // templated fallback
  });
});
