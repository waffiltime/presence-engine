import { describe, it, expect } from 'vitest';
import { adapterFor } from '../submit/registry.js';

describe('submit adapter registry', () => {
  it('routes each manifest surface to its adapter', () => {
    expect(adapterFor({ surfaceId: 'a2a-agent-card-well-known-agent-json', name: 'A2A' } as any)?.plan).toBeTypeOf('function');
    expect(adapterFor({ surfaceId: 'x402-manifest-well-known-x402', name: 'x402' } as any)?.plan).toBeTypeOf('function');
  });

  it('returns undefined for a surface no adapter owns yet', () => {
    expect(adapterFor({ surfaceId: 'reddit-relevant-subs', name: 'Reddit' } as any)).toBeUndefined();
  });
});
