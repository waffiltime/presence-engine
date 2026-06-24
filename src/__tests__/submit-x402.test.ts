import { describe, it, expect } from 'vitest';
import { x402Adapter } from '../submit/adapters/x402.js';
import { rm, readFile } from 'node:fs/promises';

const surface = { surfaceId: 'x402-manifest-well-known-x402', name: 'x402 manifest (/.well-known/x402)' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon' },
  links: { agent_endpoint: 'https://beacon.example.com/a2a', well_known_x402: 'https://beacon.example.com/.well-known/x402' },
  disambiguation: { official_domain: 'beacon.example.com' },
};

describe('x402Adapter', () => {
  it('matches only the x402 surface', () => {
    expect(x402Adapter.matches(surface)).toBe(true);
    expect(x402Adapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
  });

  it('plan() builds a manifest payload with the endpoint', () => {
    const p = x402Adapter.plan(record, surface);
    expect(p.mechanism).toBe('manifest');
    expect(p.payload.endpoint).toBe('https://beacon.example.com/a2a');
  });

  it('execute() writes the file and returns needs_human', async () => {
    const p = x402Adapter.plan(record, surface);
    const r = await x402Adapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    const written = await readFile('out/beacon/.well-known/x402', 'utf-8');
    expect(JSON.parse(written).name).toBe('Beacon');
    await rm('out/beacon', { recursive: true, force: true });
  });
});
