import { describe, it, expect, vi, afterEach } from 'vitest';
import { a2aCardAdapter } from '../submit/adapters/a2a-card.js';
import { rm, readFile } from 'node:fs/promises';

const surface = { surfaceId: 'a2a-agent-card-well-known-agent-json', name: 'A2A Agent Card (/.well-known/agent.json)' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'example MCP server' },
  positioning: { one_liner: 'An example MCP server.' },
  links: { homepage: 'https://beacon.example.com', agent_endpoint: 'https://beacon.example.com/a2a' },
  disambiguation: { official_domain: 'beacon.example.com' },
};

describe('a2aCardAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('matches only the a2a card surface', () => {
    expect(a2aCardAdapter.matches(surface)).toBe(true);
    expect(a2aCardAdapter.matches({ surfaceId: 'mcp-so', name: 'mcp.so' } as any)).toBe(false);
  });

  it('plan() produces a manifest payload whose preview is the JSON file body', () => {
    const p = a2aCardAdapter.plan(record, surface);
    expect(p.mechanism).toBe('manifest');
    expect(p.payload.name).toBe('Beacon');
    expect(p.payload.url).toBe('https://beacon.example.com/a2a');
    expect(p.preview).toContain('"name": "Beacon"');
  });

  it('execute() writes the file under out/<slug> and returns needs_human with the hosted url', async () => {
    const p = a2aCardAdapter.plan(record, surface);
    const r = await a2aCardAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    expect(r.evidenceUrl).toBe('https://beacon.example.com/.well-known/agent.json');
    const written = await readFile('out/beacon/.well-known/agent.json', 'utf-8');
    expect(JSON.parse(written).name).toBe('Beacon');
    await rm('out/beacon', { recursive: true, force: true });
  });
});
