import { ulid } from 'ulid';
import { and, eq } from 'drizzle-orm';
import { db } from '../db.js';
import { approvalQueue } from '../schema.js';
import { logEvent } from '../log.js';
import { ACTORS } from '../constants.js';

export interface EnqueueInput {
  recordId: string;
  surfaceId: string;
  managePolicy: string;
  mechanism: string;
  payload: unknown;
  payloadHash: string;
  preview: string;
}

export async function enqueue(input: EnqueueInput): Promise<string> {
  const id = ulid();
  await db.insert(approvalQueue).values({
    id,
    recordId: input.recordId,
    surfaceId: input.surfaceId,
    managePolicy: input.managePolicy,
    mechanism: input.mechanism,
    payload: input.payload,
    payloadHash: input.payloadHash,
    preview: input.preview,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function listByStatus(recordId: string, status: string) {
  return db.select().from(approvalQueue)
    .where(and(eq(approvalQueue.recordId, recordId), eq(approvalQueue.status, status)));
}

const DECISION = new Set(['approved', 'rejected']);

export async function transition(
  id: string,
  status: string,
  ctx: { recordId: string; surfaceId: string; result?: unknown; evidenceUrl?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status };
  if (DECISION.has(status)) patch.decidedAt = now;
  else patch.executedAt = now;
  if (ctx.result !== undefined) patch.result = ctx.result;
  if (ctx.evidenceUrl !== undefined) patch.evidenceUrl = ctx.evidenceUrl;
  await db.update(approvalQueue).set(patch).where(eq(approvalQueue.id, id));
  await logEvent({
    recordId: ctx.recordId,
    eventType: `submit.${status}`,
    actor: ACTORS.publisher,
    target: ctx.surfaceId,
    detail: { id, ...(ctx.evidenceUrl ? { evidenceUrl: ctx.evidenceUrl } : {}) },
  });
}
