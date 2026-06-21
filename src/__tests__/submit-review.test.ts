import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db.js';
import { approvalQueue, provenanceLog } from '../schema.js';
import { enqueue } from '../submit/queue.js';
import { listForReview, decide } from '../submit/review.js';
import { eq } from 'drizzle-orm';

describe('submit review', () => {
  let id: string;
  beforeEach(async () => {
    await db.delete(approvalQueue);
    await db.delete(provenanceLog);
    id = await enqueue({
      recordId: 'rec1', surfaceId: 's1', managePolicy: 'autonomous',
      mechanism: 'manifest', payload: {}, payloadHash: 'h', preview: 'PREVIEW',
    });
  });

  it('lists pending items for review', async () => {
    const items = await listForReview('rec1');
    expect(items.pending).toHaveLength(1);
    expect(items.pending[0].preview).toBe('PREVIEW');
  });

  it('decide(approve) flips status to approved', async () => {
    await decide(id, 'approve');
    const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, id));
    expect(row.status).toBe('approved');
  });

  it('decide(reject) flips status to rejected', async () => {
    await decide(id, 'reject');
    const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, id));
    expect(row.status).toBe('rejected');
  });
});
