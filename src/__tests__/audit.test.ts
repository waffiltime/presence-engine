import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockValues: vi.fn().mockResolvedValue(undefined),
  resolveSurfaces: vi.fn(),
  checkPresence: vi.fn(),
  coverageScore: vi.fn(),
  buildReport: vi.fn(),
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db.js', () => ({ db: { select: h.mockSelect, insert: h.mockInsert } }));
vi.mock('../surfaces/resolve.js', () => ({ resolveSurfaces: h.resolveSurfaces }));
vi.mock('../presence/check.js', () => ({ checkPresence: h.checkPresence }));
vi.mock('../score.js', () => ({ coverageScore: h.coverageScore }));
vi.mock('../report.js', () => ({ buildReport: h.buildReport }));
vi.mock('../log.js', () => ({ logEvent: h.logEvent }));

import { runAudit } from '../audit.js';

describe('runAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.mockSelect.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([
        { recordId: 'r1', kind: 'ai_agent', body: { subject: { canonical_name: 'Beacon' } } },
      ]) }),
    });
    h.mockInsert.mockReturnValue({ values: h.mockValues });
    h.resolveSurfaces.mockResolvedValue([{ surfaceId: 's1' }]);
    h.checkPresence.mockResolvedValue([{ surfaceId: 's1', state: 'listed' }]);
    h.coverageScore.mockReturnValue(80);
    h.buildReport.mockResolvedValue({ score: 80, summary: 'good', actionPoints: [] });
  });

  it('runs the pipeline, writes an audit_runs row, logs completion, returns the report', async () => {
    const report = await runAudit('r1');
    expect(h.resolveSurfaces).toHaveBeenCalledWith('ai_agent');
    expect(h.checkPresence).toHaveBeenCalled();
    expect(h.buildReport).toHaveBeenCalledWith('Beacon', 80, [{ surfaceId: 's1', state: 'listed' }]);
    expect(h.mockValues).toHaveBeenCalledWith(expect.objectContaining({ recordId: 'r1', coverageScore: 80 }));
    expect(h.logEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'audit.completed' }));
    expect(report.summary).toBe('good');
  });

  it('throws when the record is not found', async () => {
    h.mockSelect.mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) });
    await expect(runAudit('missing')).rejects.toThrow();
  });
});
