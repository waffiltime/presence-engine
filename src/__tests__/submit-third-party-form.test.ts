import { describe, it, expect } from 'vitest';
import { thirdPartyFormAdapter } from '../submit/adapters/third-party-form.js';

const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'mcp server' },
  positioning: { one_liner: 'An example MCP server.' },
  links: { homepage: 'https://beacon.example.com', repository: 'https://github.com/exampleco/beacon' },
};

describe('thirdPartyFormAdapter', () => {
  it('matches the Class C third-party surfaces', () => {
    for (const id of ['mcp-so', 'smithery-ai', 'glama-ai-mcp', 'awesome-mcp-servers-github', 'saashub', 'long-tail-ai-saas-directories-100s']) {
      expect(thirdPartyFormAdapter.matches({ surfaceId: id, name: id } as any)).toBe(true);
    }
  });

  it('does not match owned/manifest surfaces', () => {
    expect(thirdPartyFormAdapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
    expect(thirdPartyFormAdapter.matches({ surfaceId: 'a2a-agent-card-well-known-agent-json', name: 'A2A' } as any)).toBe(false);
  });

  it('plan() builds an assisted_manual packet of the submission fields', () => {
    const surface = { surfaceId: 'mcp-so', name: 'mcp.so' } as any;
    const p = thirdPartyFormAdapter.plan(record, surface);
    expect(p.mechanism).toBe('assisted_manual');
    const fields = p.payload.fields as any;
    expect(fields.name).toBe('Beacon');
    expect(fields.description).toBe('An example MCP server.');
    expect(fields.repository).toBe('https://github.com/exampleco/beacon');
    expect(p.preview).toContain('mcp.so');
    expect(p.preview).toContain('Beacon');
  });

  it('execute() does no network and returns needs_human naming the surface', async () => {
    const surface = { surfaceId: 'saashub', name: 'SaaSHub' } as any;
    const p = thirdPartyFormAdapter.plan(record, surface);
    const r = await thirdPartyFormAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    expect(r.notes).toContain('SaaSHub');
  });
});
