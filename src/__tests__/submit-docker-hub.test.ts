import { describe, it, expect, vi, afterEach } from 'vitest';
import { dockerHubAdapter } from '../submit/adapters/docker-hub.js';

const surface = { surfaceId: 'docker-hub', name: 'Docker Hub' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon' },
  positioning: { one_liner: 'An example image.', long_description: 'Longer description of Beacon.' },
  links: { docker_image: 'exampleco/beacon' },
};

describe('dockerHubAdapter', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('matches only the docker-hub surface', () => {
    expect(dockerHubAdapter.matches(surface)).toBe(true);
    expect(dockerHubAdapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
  });

  it('plan() parses namespace/repo and builds an api payload', () => {
    const p = dockerHubAdapter.plan(record, surface);
    expect(p.mechanism).toBe('api');
    expect(p.payload.namespace).toBe('exampleco');
    expect(p.payload.repository).toBe('beacon');
    expect(String(p.payload.full_description)).toContain('Beacon');
  });

  it('execute() without credentials returns failed', async () => {
    vi.stubEnv('DOCKERHUB_USERNAME', '');
    vi.stubEnv('DOCKERHUB_TOKEN', '');
    const p = dockerHubAdapter.plan(record, surface);
    const r = await dockerHubAdapter.execute(p, surface);
    expect(r.outcome).toBe('failed');
    expect(r.notes).toMatch(/DOCKERHUB/);
  });

  it('execute() logs in then PATCHes the description and returns submitted', async () => {
    vi.stubEnv('DOCKERHUB_USERNAME', 'exampleco');
    vi.stubEnv('DOCKERHUB_TOKEN', 'pat');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 200, json: () => Promise.resolve({ token: 'jwt123' }) })
      .mockResolvedValueOnce({ status: 200, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    const p = dockerHubAdapter.plan(record, surface);
    const r = await dockerHubAdapter.execute(p, surface);
    expect(r.outcome).toBe('submitted');
    expect(r.evidenceUrl).toBe('https://hub.docker.com/r/exampleco/beacon');
    const patchCall = fetchMock.mock.calls[1];
    expect(patchCall[0]).toContain('/v2/repositories/exampleco/beacon/');
    expect(patchCall[1].headers.Authorization).toBe('JWT jwt123');
  });

  it('execute() returns failed when login fails', async () => {
    vi.stubEnv('DOCKERHUB_USERNAME', 'exampleco');
    vi.stubEnv('DOCKERHUB_TOKEN', 'bad');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ status: 401, json: () => Promise.resolve({}) }));
    const p = dockerHubAdapter.plan(record, surface);
    const r = await dockerHubAdapter.execute(p, surface);
    expect(r.outcome).toBe('failed');
  });
});
