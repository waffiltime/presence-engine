import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db.js';
import { canonicalRecords, auditRuns, approvalQueue } from '../schema.js';
import { resolveSurfaces } from '../surfaces/resolve.js';
import { adapterFor } from './registry.js';
import { enqueue } from './queue.js';

const ACTIONABLE = new Set(['autonomous', 'draft_only']);
const OPEN_STATUSES = ['pending', 'approved', 'submitted', 'pending_external', 'needs_human'];

// Owned-channel updates (e.g. GitHub repo metadata) are NOT creates — propose them
// even when presence says 'listed'; payload-hash idempotency stops redundant work.
const UPDATE_MECHANISMS = new Set(['api']);

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function planSubmissions(recordId: string): Promise<number> {
  const [rec] = await db.select().from(canonicalRecords).where(eq(canonicalRecords.recordId, recordId));
  if (!rec) throw new Error(`No record: ${recordId}`);

  const [latestAudit] = await db.select().from(auditRuns)
    .where(eq(auditRuns.recordId, recordId)).orderBy(desc(auditRuns.finishedAt)).limit(1);
  if (!latestAudit) throw new Error(`No audit found for ${recordId} — run the audit first.`);

  const presence = (latestAudit.presence as Array<{ surfaceId: string; state: string; confidence: string }>) ?? [];
  const presenceBy = new Map(presence.map(p => [p.surfaceId, p]));

  const record = rec.body as any;
  const surfaces = await resolveSurfaces(rec.kind);

  let enqueued = 0;
  for (const surface of surfaces) {
    if (!ACTIONABLE.has(surface.managePolicy)) continue;

    const pres = presenceBy.get(surface.surfaceId);
    if (!pres) continue; // only act on surfaces the audit evaluated

    const adapter = adapterFor(surface);
    if (!adapter) continue;

    const proposal = adapter.plan(record, surface);

    // Skip when already listed — but ONLY for create-type mechanisms.
    if (!UPDATE_MECHANISMS.has(proposal.mechanism)
        && pres.state === 'listed' && pres.confidence === 'high') continue;

    const payloadHash = hashPayload(proposal.payload);

    const existing = await db.select().from(approvalQueue).where(and(
      eq(approvalQueue.recordId, recordId),
      eq(approvalQueue.surfaceId, surface.surfaceId),
      inArray(approvalQueue.status, OPEN_STATUSES),
    ));
    if (existing.some(r => r.payloadHash === payloadHash)) continue;

    // Tidy: a prior failed attempt with this exact payload is being re-proposed —
    // drop it so the queue holds one row per (surface, payload), not a pile.
    await db.delete(approvalQueue).where(and(
      eq(approvalQueue.recordId, recordId),
      eq(approvalQueue.surfaceId, surface.surfaceId),
      eq(approvalQueue.status, 'failed'),
      eq(approvalQueue.payloadHash, payloadHash),
    ));

    await enqueue({
      recordId, surfaceId: surface.surfaceId, managePolicy: surface.managePolicy,
      mechanism: proposal.mechanism, payload: proposal.payload, payloadHash, preview: proposal.preview,
    });
    enqueued++;
  }
  return enqueued;
}
