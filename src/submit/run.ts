import { and, eq } from 'drizzle-orm';
import { db } from '../db.js';
import { approvalQueue, surfaces } from '../schema.js';
import { adapterFor } from './registry.js';
import { transition } from './queue.js';
import type { SubmitResult } from './types.js';

export async function runApproved(recordId: string): Promise<SubmitResult[]> {
  const approved = await db.select().from(approvalQueue)
    .where(and(eq(approvalQueue.recordId, recordId), eq(approvalQueue.status, 'approved')));

  const results: SubmitResult[] = [];
  for (const row of approved) {
    const [surface] = await db.select().from(surfaces).where(eq(surfaces.surfaceId, row.surfaceId));
    const adapter = surface ? adapterFor(surface) : undefined;
    if (!surface || !adapter) {
      await transition(row.id, 'failed', { recordId, surfaceId: row.surfaceId, result: { error: 'no adapter for surface' } });
      results.push({ outcome: 'failed', notes: 'no adapter' });
      continue;
    }
    try {
      const r = await adapter.execute({ mechanism: row.mechanism as any, payload: row.payload as any, preview: row.preview }, surface);
      await transition(row.id, r.outcome, { recordId, surfaceId: row.surfaceId, result: r, evidenceUrl: r.evidenceUrl });
      results.push(r);
    } catch (e: any) {
      await transition(row.id, 'failed', { recordId, surfaceId: row.surfaceId, result: { error: e.message } });
      results.push({ outcome: 'failed', notes: e.message });
    }
  }
  return results;
}
