import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db.js';
import { connectionStatus, surfaces } from '../schema.js';
import { connectSurfaces } from '../submit/connect.js';
import { eq } from 'drizzle-orm';

const GH = 'github-repo-about-topics-readme-releases';

async function seedGithub() {
  await db.insert(surfaces).values({
    surfaceId: GH, name: 'GitHub repo', url: null, surfaceType: 'owned_channel',
    relevantKinds: ['agent'], monitor: 'full', managePolicy: 'autonomous',
    manageMechanism: null, feedDriven: true, notes: null, buildPriority: 'P1',
  }).onConflictDoNothing();
}

async function seedDocker() {
  await db.insert(surfaces).values({
    surfaceId: 'docker-hub', name: 'Docker Hub', url: null, surfaceType: 'package_registry',
    relevantKinds: ['api', 'dev'], monitor: 'full', managePolicy: 'autonomous',
    manageMechanism: null, feedDriven: true, notes: null, buildPriority: 'P2',
  }).onConflictDoNothing();
}

describe('connectSurfaces', () => {
  beforeEach(async () => {
    await db.delete(connectionStatus);
    await db.delete(surfaces);
    await seedGithub();
    vi.unstubAllEnvs();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('records missing when the token env var is unset', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const summary = await connectSurfaces('rec1', 'ai_agent');
    expect(summary.find(s => s.surfaceId === GH)?.state).toBe('missing');
    const [row] = await db.select().from(connectionStatus).where(eq(connectionStatus.surfaceId, GH));
    expect(row.state).toBe('missing');
  });

  it('records connected when the token verifies', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    const summary = await connectSurfaces('rec1', 'ai_agent');
    expect(summary.find(s => s.surfaceId === GH)?.state).toBe('connected');
  });

  it('records invalid when the token fails verification', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'bad');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401 }));
    const summary = await connectSurfaces('rec1', 'ai_agent');
    expect(summary.find(s => s.surfaceId === GH)?.state).toBe('invalid');
  });

  it('verifies Docker Hub via login when the token is set', async () => {
    await seedDocker();
    vi.stubEnv('DOCKERHUB_USERNAME', 'exampleco');
    vi.stubEnv('DOCKERHUB_TOKEN', 'pat');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    const summary = await connectSurfaces('rec1', 'dev_tool');
    expect(summary.find(s => s.surfaceId === 'docker-hub')?.state).toBe('connected');
  });

  it('records present_unverified when verification throws', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const summary = await connectSurfaces('rec1', 'ai_agent');
    expect(summary.find(s => s.surfaceId === GH)?.state).toBe('present_unverified');
  });
});
