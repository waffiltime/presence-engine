import { and, eq } from 'drizzle-orm';
import { db } from '../db.js';
import { connectionStatus } from '../schema.js';
import { resolveSurfaces } from '../surfaces/resolve.js';
import { credentialSpecFor } from './credentials.js';

export interface ConnectionSummaryItem {
  surfaceId: string;
  envVar: string;
  state: 'connected' | 'missing' | 'invalid' | 'present_unverified';
  mintUrl: string;
}

async function upsert(recordId: string, surfaceId: string, state: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.select().from(connectionStatus)
    .where(and(eq(connectionStatus.recordId, recordId), eq(connectionStatus.surfaceId, surfaceId)));
  if (existing.length) {
    await db.update(connectionStatus).set({ state, lastVerifiedAt: now })
      .where(and(eq(connectionStatus.recordId, recordId), eq(connectionStatus.surfaceId, surfaceId)));
  } else {
    await db.insert(connectionStatus).values({ recordId, surfaceId, state, lastVerifiedAt: now });
  }
}

export async function connectSurfaces(recordId: string, kind: string): Promise<ConnectionSummaryItem[]> {
  const surfaces = await resolveSurfaces(kind);
  const summary: ConnectionSummaryItem[] = [];
  for (const surface of surfaces) {
    const spec = credentialSpecFor(surface.surfaceId);
    if (!spec) continue;
    const token = process.env[spec.envVar];
    let state: ConnectionSummaryItem['state'];
    if (!token) {
      state = 'missing';
    } else {
      try {
        state = (await spec.verify(token)) ? 'connected' : 'invalid';
      } catch {
        state = 'present_unverified';
      }
    }
    await upsert(recordId, surface.surfaceId, state);
    summary.push({ surfaceId: surface.surfaceId, envVar: spec.envVar, state, mintUrl: spec.mintUrl });
  }
  return summary;
}
