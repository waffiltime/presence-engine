import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { websearchAdapter } from '../presence/adapters/websearch.js';

const record = { subject: { canonical_name: 'Beacon', slug: 'beacon' } };
const surface = { surfaceId: 'mcp-so', name: 'mcp.so', url: 'https://mcp.so' } as any;

describe('websearchAdapter', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('matches any surface (catch-all)', () => {
    expect(websearchAdapter.matches(surface)).toBe(true);
    expect(websearchAdapter.matches({ surfaceId: 'x', name: 'anything' } as any)).toBe(true);
  });

  it('degrades to unknown/low when no search API key', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
    const r = await websearchAdapter.check(record, surface);
    expect(r.state).toBe('unknown');
    expect(r.confidence).toBe('low');
  });

  it('listed/low when search returns results', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ web: { results: [{ url: 'https://mcp.so/beacon' }] } }),
    }));
    const r = await websearchAdapter.check(record, surface);
    expect(r.state).toBe('listed');
    expect(r.confidence).toBe('low');
    expect(r.evidenceUrl).toContain('mcp.so');
  });

  it('absent/low when search returns no results', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ web: { results: [] } }),
    }));
    const r = await websearchAdapter.check(record, surface);
    expect(r.state).toBe('absent');
    expect(r.confidence).toBe('low');
  });

  it('unknown/low on a non-200 search response', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 429, json: () => Promise.resolve({}) }));
    const r = await websearchAdapter.check(record, surface);
    expect(r.state).toBe('unknown');
    expect(r.confidence).toBe('low');
  });
});
