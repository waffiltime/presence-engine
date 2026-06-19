import { describe, it, expect } from 'vitest';
import {
  canonicalRecords, recordVersions, surfaces,
  mentions, opportunities, provenanceLog, auditRuns,
} from '../schema.js';

describe('schema exports', () => {
  it('exports all 7 tables', () => {
    for (const t of [canonicalRecords, recordVersions, surfaces,
      mentions, opportunities, provenanceLog, auditRuns]) {
      expect(t).toBeDefined();
    }
  });
});
