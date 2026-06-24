import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db.js';
import { approvalQueue, provenanceLog, surfaces } from '../schema.js';
import { enqueue, transition } from '../submit/queue.js';
import { runApproved } from '../submit/run.js';
import { eq } from 'drizzle-orm';

const SID = 'a2a-agent-card-well-known-agent-json';

describe('runApproved', () => {
  let id: string;
  beforeEach(async () => {
    await db.delete(approvalQueue);
    await db.delete(provenanceLog);
    await db.delete(surfaces);
    await db.insert(surfaces).values({
      surfaceId: SID, name: 'A2A', url: null, surfaceType: 'owned_manifest',
      relevantKinds: ['agent'], monitor: 'full', managePolicy: 'autonomous',
      manageMechanism: null, feedDriven: true, notes: null, buildPriority: 'P1',
    }).onConflictDoNothing();
    id = await enqueue({
      recordId: 'rec1', surfaceId: SID, managePolicy: 'autonomous', mechanism: 'manifest',
      payload: { name: 'Beacon', provider: { organization: 'beacon.example.com' }, _slug: 'beacon', _path: '.well-known/agent.json' },
      payloadHash: 'h', preview: 'p',
    });
  });

  it('executes only approved rows and records the outcome', async () => {
    await transition(id, 'approved', { recordId: 'rec1', surfaceId: SID });
    const results = await runApproved('rec1');
    expect(results).toHaveLength(1);
    const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, id));
    expect(row.status).toBe('needs_human');
    expect(row.executedAt).toBeTruthy();
    const { rm } = await import('node:fs/promises');
    await rm('out/beacon', { recursive: true, force: true });
  });

  it('leaves pending (un-approved) rows untouched', async () => {
    const results = await runApproved('rec1');
    expect(results).toHaveLength(0);
    const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, id));
    expect(row.status).toBe('pending');
  });
});
