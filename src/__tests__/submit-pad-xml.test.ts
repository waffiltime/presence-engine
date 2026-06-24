import { describe, it, expect } from 'vitest';
import { padXmlAdapter } from '../submit/adapters/pad-xml.js';
import { rm, readFile } from 'node:fs/promises';

const surface = { surfaceId: 'pad-friendly-portals-softpedia-sourceforge-majorgeeks-snapfiles-', name: 'PAD-friendly portals' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon' },
  positioning: { one_liner: 'An example desktop app.' },
  links: { homepage: 'https://beacon.example.com' },
  attributes: { current_version: '2.1' },
};

describe('padXmlAdapter', () => {
  it('matches the PAD portals surface', () => {
    expect(padXmlAdapter.matches(surface)).toBe(true);
    expect(padXmlAdapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
  });

  it('plan() produces XML preview containing the program name and version', () => {
    const p = padXmlAdapter.plan(record, surface);
    expect(p.mechanism).toBe('manifest');
    expect(p.preview).toContain('<Program_Name>Beacon</Program_Name>');
    expect(p.preview).toContain('<Program_Version>2.1</Program_Version>');
  });

  it('execute() writes pad.xml and returns needs_human', async () => {
    const p = padXmlAdapter.plan(record, surface);
    const r = await padXmlAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    const written = await readFile('out/beacon/pad.xml', 'utf-8');
    expect(written).toContain('<Program_Name>Beacon</Program_Name>');
    await rm('out/beacon', { recursive: true, force: true });
  });
});
