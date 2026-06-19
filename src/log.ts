import { ulid } from 'ulid';
import { db } from './db.js';
import { provenanceLog } from './schema.js';
import type { Actor } from './constants.js';

export async function logEvent(e: {
  recordId?: string;
  eventType: string;
  actor: Actor;
  target?: string;
  detail?: unknown;
}): Promise<void> {
  await db.insert(provenanceLog).values({
    id: ulid(),
    createdAt: new Date().toISOString(),
    recordId: e.recordId ?? null,
    eventType: e.eventType,
    actor: e.actor,
    target: e.target ?? null,
    detail: e.detail ?? null,
  });
}
