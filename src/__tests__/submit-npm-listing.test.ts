import { describe, it, expect } from 'vitest';
import { npmListingAdapter } from '../submit/adapters/npm-listing.js';

const surface = { surfaceId: 'npm', name: 'npm' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'mcp server' },
  positioning: { one_liner: 'An example MCP server.' },
  links: { homepage: 'https://beacon.example.com', repository: 'https://github.com/exampleco/beacon', npm_package: 'beacon-mcp' },
};

describe('npmListingAdapter', () => {
  it('matches only the npm surface', () => {
    expect(npmListingAdapter.matches(surface)).toBe(true);
    expect(npmListingAdapter.matches({ surfaceId: 'pypi', name: 'PyPI' } as any)).toBe(false);
  });

  it('plan() builds an assisted_manual payload of package.json fields', () => {
    const p = npmListingAdapter.plan(record, surface);
    expect(p.mechanism).toBe('assisted_manual');
    expect((p.payload.fields as any).description).toBe('An example MCP server.');
    expect((p.payload.fields as any).homepage).toBe('https://beacon.example.com');
    expect(p.preview).toContain('package.json');
  });

  it('execute() does no network and returns needs_human', async () => {
    const p = npmListingAdapter.plan(record, surface);
    const r = await npmListingAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    expect(r.notes).toMatch(/publish/i);
  });
});
