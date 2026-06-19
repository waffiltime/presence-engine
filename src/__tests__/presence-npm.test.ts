import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { npmAdapter } from '../presence/adapters/npm.js';

const surface = { surfaceId: 'npm', name: 'npm', surfaceType: 'package_registry' } as any;

describe('npmAdapter', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('matches the npm surface only', () => {
    expect(npmAdapter.matches(surface)).toBe(true);
    expect(npmAdapter.matches({ surfaceId: 'pypi', name: 'PyPI' } as any)).toBe(false);
    expect(npmAdapter.matches({ surfaceId: 'mcp-so', name: 'mcp.so' } as any)).toBe(false);
  });

  it('absent/high when no npm package name is declared', async () => {
    const r = await npmAdapter.check({ links: {} }, surface);
    expect(r.state).toBe('absent');
    expect(r.confidence).toBe('high');
  });

  it('listed/high when the registry returns 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve({}) }));
    const r = await npmAdapter.check({ links: { npm_package: 'beacon-mcp' } }, surface);
    expect(r.state).toBe('listed');
    expect(r.confidence).toBe('high');
    expect(r.evidenceUrl).toContain('beacon-mcp');
  });

  it('absent/high when the registry returns 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, json: () => Promise.resolve({}) }));
    const r = await npmAdapter.check({ links: { npm_package: 'no-such-pkg' } }, surface);
    expect(r.state).toBe('absent');
    expect(r.confidence).toBe('high');
  });

  it('unknown/low on any other registry status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500, json: () => Promise.resolve({}) }));
    const r = await npmAdapter.check({ links: { npm_package: 'beacon-mcp' } }, surface);
    expect(r.state).toBe('unknown');
    expect(r.confidence).toBe('low');
  });
});
