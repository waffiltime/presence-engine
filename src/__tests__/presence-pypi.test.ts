import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pypiAdapter } from '../presence/adapters/pypi.js';

const surface = { surfaceId: 'pypi', name: 'PyPI', surfaceType: 'package_registry' } as any;

describe('pypiAdapter', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('matches the pypi surface only', () => {
    expect(pypiAdapter.matches(surface)).toBe(true);
    expect(pypiAdapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
  });

  it('absent/high when no pypi package name is declared', async () => {
    const r = await pypiAdapter.check({ links: {} }, surface);
    expect(r.state).toBe('absent');
    expect(r.confidence).toBe('high');
  });

  it('listed/high when the registry returns 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve({}) }));
    const r = await pypiAdapter.check({ links: { pypi_package: 'beacon' } }, surface);
    expect(r.state).toBe('listed');
    expect(r.confidence).toBe('high');
    expect(r.evidenceUrl).toContain('beacon');
  });

  it('absent/high when the registry returns 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, json: () => Promise.resolve({}) }));
    const r = await pypiAdapter.check({ links: { pypi_package: 'no-such-pkg' } }, surface);
    expect(r.state).toBe('absent');
    expect(r.confidence).toBe('high');
  });

  it('unknown/low on any other registry status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 503, json: () => Promise.resolve({}) }));
    const r = await pypiAdapter.check({ links: { pypi_package: 'beacon' } }, surface);
    expect(r.state).toBe('unknown');
    expect(r.confidence).toBe('low');
  });
});
