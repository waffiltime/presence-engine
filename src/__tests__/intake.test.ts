import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mocks, state } = vi.hoisted(() => {
  const state = { existing: [] as any[] };
  const insertValues = vi.fn(async () => undefined);
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn((_set: Record<string, unknown>) => ({ where: updateWhere }));
  const mocks = {
    insertValues,
    updateSet,
    db: {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => state.existing) })) })),
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
    },
  };
  return { mocks, state };
});
vi.mock('../db.js', () => ({ db: mocks.db }));
vi.mock('../log.js', () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));

import { logEvent } from '../log.js';
import { intakeRecord } from '../record/intake.js';

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: '1.0',
    record_id: 'rec_test_0001',
    subject: { kind: 'ai_agent', canonical_name: 'Beacon', slug: 'beacon', lifecycle_status: 'live' },
    ...overrides,
  };
}

describe('intakeRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.existing = [];
  });

  it('inserts a new record, lifting kind/slug/status into columns', async () => {
    const id = await intakeRecord(makeRecord());
    expect(id).toBe('rec_test_0001');
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 'rec_test_0001', kind: 'ai_agent', slug: 'beacon', lifecycleStatus: 'live', version: 1,
    }));
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'record.created' }));
  });

  it('throws on an invalid record and does not insert or update', async () => {
    const bad = makeRecord();
    delete (bad.subject as Record<string, unknown>).kind;
    await expect(intakeRecord(bad)).rejects.toThrow();
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it('updates an existing record: snapshots old body, bumps version, logs record.updated', async () => {
    state.existing = [{ recordId: 'rec_test_0001', version: 2, body: { old: true } }];
    const id = await intakeRecord(makeRecord());
    expect(id).toBe('rec_test_0001');
    // old body snapshotted into record_versions at its old version number
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 'rec_test_0001', version: 2, body: { old: true },
    }));
    // canonical row updated with bumped version + new body
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      version: 3, kind: 'ai_agent', slug: 'beacon', lifecycleStatus: 'live',
    }));
    // update must not overwrite creation metadata
    const updatePayload = mocks.updateSet.mock.calls[0][0];
    expect(updatePayload).not.toHaveProperty('systemStatus');
    expect(updatePayload).not.toHaveProperty('createdAt');
    // exactly one snapshot insert and one canonical update
    expect(mocks.db.insert).toHaveBeenCalledTimes(1);
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'record.updated' }));
  });
});
