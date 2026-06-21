import { describe, it, expect } from 'vitest';
import { pypiListingAdapter } from '../submit/adapters/pypi-listing.js';

const surface = { surfaceId: 'pypi', name: 'PyPI' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'mcp server' },
  positioning: { one_liner: 'An example MCP server.' },
  links: { homepage: 'https://beacon.example.com', pypi_package: 'beacon' },
};

describe('pypiListingAdapter', () => {
  it('matches only the pypi surface', () => {
    expect(pypiListingAdapter.matches(surface)).toBe(true);
    expect(pypiListingAdapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
  });

  it('plan() builds an assisted_manual payload of project metadata', () => {
    const p = pypiListingAdapter.plan(record, surface);
    expect(p.mechanism).toBe('assisted_manual');
    expect((p.payload.fields as any).description).toBe('An example MCP server.');
    expect(p.preview).toContain('pyproject.toml');
  });

  it('execute() does no network and returns needs_human', async () => {
    const p = pypiListingAdapter.plan(record, surface);
    const r = await pypiListingAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    expect(r.notes).toMatch(/release|publish/i);
  });
});
