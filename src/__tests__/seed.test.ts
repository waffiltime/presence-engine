import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInsert, mockValues } = vi.hoisted(() => {
  const mockValues = vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
  return { mockInsert, mockValues };
});
vi.mock('../db.js', () => ({ db: { insert: mockInsert } }));

import { seedSurfaces } from '../seed.js';

describe('seedSurfaces', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a row for each CSV surface', async () => {
    const count = await seedSurfaces();
    expect(count).toBeGreaterThan(0);
    expect(mockValues).toHaveBeenCalledTimes(count);
  });

  it('includes at least one surface with the agent kind', async () => {
    await seedSurfaces();
    const rows = mockValues.mock.calls.map(c => c[0]);
    const agentSurfaces = rows.filter(r => Array.isArray(r.relevantKinds) && r.relevantKinds.includes('agent'));
    expect(agentSurfaces.length).toBeGreaterThan(0);
  });
});
