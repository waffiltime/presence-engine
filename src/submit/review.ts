import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db.js';
import { approvalQueue } from '../schema.js';
import { transition } from './queue.js';

export async function listForReview(recordId: string) {
  const pending = await db.select().from(approvalQueue)
    .where(and(eq(approvalQueue.recordId, recordId), eq(approvalQueue.status, 'pending')));
  const todo = await db.select().from(approvalQueue)
    .where(and(eq(approvalQueue.recordId, recordId), inArray(approvalQueue.status, ['needs_human'])));
  return { pending, todo };
}

export async function decide(id: string, decision: 'approve' | 'reject'): Promise<void> {
  const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, id));
  if (!row) throw new Error(`No queue item: ${id}`);
  const status = decision === 'approve' ? 'approved' : 'rejected';
  await transition(id, status, { recordId: row.recordId, surfaceId: row.surfaceId });
}
