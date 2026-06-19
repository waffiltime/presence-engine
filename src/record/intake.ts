import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { canonicalRecords, recordVersions } from '../schema.js';
import { validateRecord } from './validate.js';
import { logEvent } from '../log.js';
import { ACTORS } from '../constants.js';

export async function intakeRecord(record: any): Promise<string> {
  const result = validateRecord(record);
  if (!result.ok) {
    throw new Error(`Record failed validation:\n${result.errors.join('\n')}`);
  }
  const recordId = record.record_id ?? ulid();
  const now = new Date().toISOString();

  const [existing] = await db.select().from(canonicalRecords)
    .where(eq(canonicalRecords.recordId, recordId));

  if (existing) {
    // Snapshot the outgoing version (append-only), then update in place.
    await db.insert(recordVersions).values({
      id: ulid(),
      recordId,
      version: existing.version,
      body: existing.body,
      createdAt: now,
    });
    await db.update(canonicalRecords).set({
      kind: record.subject.kind,
      slug: record.subject.slug,
      lifecycleStatus: record.subject.lifecycle_status,
      schemaVersion: record.schema_version,
      version: existing.version + 1,
      body: record,
      updatedAt: now,
    }).where(eq(canonicalRecords.recordId, recordId));
    await logEvent({ recordId, eventType: 'record.updated', actor: ACTORS.human, detail: { version: existing.version + 1 } });
  } else {
    await db.insert(canonicalRecords).values({
      recordId,
      kind: record.subject.kind,
      slug: record.subject.slug,
      lifecycleStatus: record.subject.lifecycle_status,
      systemStatus: 'active',
      schemaVersion: record.schema_version,
      version: 1,
      body: record,
      createdAt: now,
      updatedAt: now,
    });
    await logEvent({ recordId, eventType: 'record.created', actor: ACTORS.human });
  }
  return recordId;
}
