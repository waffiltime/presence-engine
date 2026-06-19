import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.hoisted(() =>
  vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })
);
vi.mock('../db.js', () => ({ db: { insert: mockInsert } }));
vi.mock('ulid', () => ({ ulid: () => '01TESTULID00000000000000000' }));

import { logEvent } from '../log.js';

describe('logEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a row into provenance_log with correct shape', async () => {
    await logEvent({ eventType: 'health.ping', actor: 'researcher' });
    expect(mockInsert).toHaveBeenCalledOnce();
    const valuesCall = mockInsert.mock.results[0].value.values;
    expect(valuesCall).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'health.ping', actor: 'researcher', id: '01TESTULID00000000000000000',
    }));
  });

  it('accepts optional recordId, target, detail', async () => {
    await logEvent({ recordId: 'rec-1', eventType: 'record.created', actor: 'human', target: 'surf-1', detail: { foo: 'bar' } });
    const valuesCall = mockInsert.mock.results[0].value.values;
    expect(valuesCall).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 'rec-1', target: 'surf-1', detail: { foo: 'bar' },
    }));
  });
});
