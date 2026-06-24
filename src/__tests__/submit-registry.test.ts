import { describe, it, expect } from 'vitest';
import { adapterFor } from '../submit/registry.js';

describe('submit adapter registry', () => {
  it('routes each manifest surface to its adapter', () => {
    expect(adapterFor({ surfaceId: 'a2a-agent-card-well-known-agent-json', name: 'A2A' } as any)?.plan).toBeTypeOf('function');
    expect(adapterFor({ surfaceId: 'x402-manifest-well-known-x402', name: 'x402' } as any)?.plan).toBeTypeOf('function');
  });

  it('returns undefined for a surface no adapter owns yet', () => {
    expect(adapterFor({ surfaceId: 'some-unknown-surface', name: 'Unknown' } as any)).toBeUndefined();
  });

  it('routes the github repo surface to the api adapter', () => {
    const a = adapterFor({ surfaceId: 'github-repo-about-topics-readme-releases', name: 'GitHub repo' } as any);
    expect(a?.plan({ links: {} } as any, {} as any).mechanism).toBe('api');
  });

  it('routes npm and pypi to assisted-manual adapters', () => {
    expect(adapterFor({ surfaceId: 'npm', name: 'npm' } as any)?.plan({ links: {} } as any, {} as any).mechanism).toBe('assisted_manual');
    expect(adapterFor({ surfaceId: 'pypi', name: 'PyPI' } as any)?.plan({ links: {} } as any, {} as any).mechanism).toBe('assisted_manual');
  });

  it('routes Class C third-party surfaces to the assisted-manual adapter', () => {
    for (const id of ['mcp-so', 'smithery-ai', 'glama-ai-mcp', 'awesome-mcp-servers-github', 'saashub', 'long-tail-ai-saas-directories-100s']) {
      const a = adapterFor({ surfaceId: id, name: id } as any);
      expect(a?.plan({ subject: {}, links: {} } as any, { surfaceId: id, name: id } as any).mechanism).toBe('assisted_manual');
    }
  });

  it('routes docker-hub to api and hugging-face to assisted-manual', () => {
    expect(adapterFor({ surfaceId: 'docker-hub', name: 'Docker Hub' } as any)?.plan({ links: {} } as any, {} as any).mechanism).toBe('api');
    expect(adapterFor({ surfaceId: 'hugging-face', name: 'Hugging Face' } as any)?.plan({ subject: {}, positioning: {}, links: {} } as any, {} as any).mechanism).toBe('assisted_manual');
  });

  it('routes community/social surfaces to the draft adapter', () => {
    for (const id of ['hacker-news-show-hn', 'reddit-relevant-subs', 'dev-to', 'x-twitter', 'product-hunt']) {
      const a = adapterFor({ surfaceId: id, name: id } as any);
      expect(a?.plan({ subject: {}, positioning: {}, links: {} } as any, { surfaceId: id, name: id } as any).mechanism).toBe('draft');
    }
  });
});
