import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db.js';
import { approvalQueue, provenanceLog } from '../schema.js';
import { enqueue, listByStatus, transition } from '../submit/queue.js';
import { eq } from 'drizzle-orm';

describe('submit queue', () => {
  beforeEach(async () => {
    await db.delete(approvalQueue);
    await db.delete(provenanceLog);
  });

  it('enqueues a pending proposal and lists it by status', async () => {
    const id = await enqueue({
      recordId: 'rec1', surfaceId: 'a2a-agent-card-well-known-agent-json',
      managePolicy: 'autonomous', mechanism: 'manifest',
      payload: { a: 1 }, payloadHash: 'h1', preview: 'preview text',
    });
    expect(id).toBeTruthy();
    const pending = await listByStatus('rec1', 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].mechanism).toBe('manifest');
  });

  it('transition updates status, stamps a timestamp, and writes a provenance row', async () => {
    const id = await enqueue({
      recordId: 'rec1', surfaceId: 's1', managePolicy: 'autonomous',
      mechanism: 'manifest', payload: {}, payloadHash: 'h', preview: 'p',
    });
    await transition(id, 'approved', { recordId: 'rec1', surfaceId: 's1' });
    const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, id));
    expect(row.status).toBe('approved');
    expect(row.decidedAt).toBeTruthy();
    const log = await db.select().from(provenanceLog);
    expect(log).toHaveLength(1);
    expect(log[0].eventType).toBe('submit.approved');
    expect(log[0].actor).toBe('publisher');
  });
});
