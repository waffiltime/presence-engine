import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db.js';
import { approvalQueue, canonicalRecords, auditRuns, surfaces } from '../schema.js';
import { planSubmissions } from '../submit/plan.js';
import { ulid } from 'ulid';

const recordId = 'rec_plan_test';
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', kind: 'ai_agent' },
  positioning: { one_liner: 'x' },
  links: { agent_endpoint: 'https://beacon.example.com/a2a', homepage: 'https://beacon.example.com', repository: 'https://github.com/exampleco/beacon' },
  disambiguation: { official_domain: 'beacon.example.com' },
};

async function seedSurface(id: string, managePolicy: string) {
  await db.insert(surfaces).values({
    surfaceId: id, name: id, url: null, surfaceType: 'owned_manifest',
    relevantKinds: ['agent'], monitor: 'full', managePolicy, manageMechanism: null,
    feedDriven: true, notes: null, buildPriority: 'P1',
  }).onConflictDoNothing();
}

describe('planSubmissions', () => {
  beforeEach(async () => {
    await db.delete(approvalQueue);
    await db.delete(auditRuns);
    await db.delete(canonicalRecords);
    await db.delete(surfaces);
    await db.insert(canonicalRecords).values({
      recordId, kind: 'ai_agent', slug: 'beacon', lifecycleStatus: 'live', systemStatus: 'active',
      schemaVersion: '1.0', version: 1, body: record, createdAt: 'now', updatedAt: 'now',
    });
    await seedSurface('a2a-agent-card-well-known-agent-json', 'autonomous');
    await seedSurface('wikipedia', 'never');
    await seedSurface('github-repo-about-topics-readme-releases', 'autonomous');
  });

  it('enqueues a pending proposal for an autonomous manifest surface that is absent', async () => {
    await db.insert(auditRuns).values({
      auditId: ulid(), recordId, coverageScore: 0, report: {}, startedAt: 'a', finishedAt: 'b',
      presence: [{ surfaceId: 'a2a-agent-card-well-known-agent-json', state: 'absent', confidence: 'high' }],
    });
    const n = await planSubmissions(recordId);
    expect(n).toBe(1);
    const rows = await db.select().from(approvalQueue);
    expect(rows).toHaveLength(1);
    expect(rows[0].mechanism).toBe('manifest');
    expect(rows[0].status).toBe('pending');
  });

  it('never proposes a manage_policy=never surface', async () => {
    await db.insert(auditRuns).values({
      auditId: ulid(), recordId, coverageScore: 0, report: {}, startedAt: 'a', finishedAt: 'b',
      presence: [{ surfaceId: 'wikipedia', state: 'absent', confidence: 'high' }],
    });
    const n = await planSubmissions(recordId);
    expect(n).toBe(0);
    expect(await db.select().from(approvalQueue)).toHaveLength(0);
  });

  it('is idempotent: re-planning with no change enqueues nothing new', async () => {
    await db.insert(auditRuns).values({
      auditId: ulid(), recordId, coverageScore: 0, report: {}, startedAt: 'a', finishedAt: 'b',
      presence: [{ surfaceId: 'a2a-agent-card-well-known-agent-json', state: 'absent', confidence: 'high' }],
    });
    await planSubmissions(recordId);
    const n2 = await planSubmissions(recordId);
    expect(n2).toBe(0);
    expect(await db.select().from(approvalQueue)).toHaveLength(1);
  });

  it('throws a clear error when there is no audit to plan from', async () => {
    await expect(planSubmissions(recordId)).rejects.toThrow(/audit/i);
  });

  it('proposes an owned-channel api surface even when presence says listed', async () => {
    await db.insert(auditRuns).values({
      auditId: ulid(), recordId, coverageScore: 0, report: {}, startedAt: 'a', finishedAt: 'b',
      presence: [{ surfaceId: 'github-repo-about-topics-readme-releases', state: 'listed', confidence: 'high' }],
    });
    const n = await planSubmissions(recordId);
    expect(n).toBe(1);
    const rows = await db.select().from(approvalQueue);
    expect(rows[0].mechanism).toBe('api');
  });
});
