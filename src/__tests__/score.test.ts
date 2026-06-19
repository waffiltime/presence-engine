import { describe, it, expect } from 'vitest';
import { coverageScore } from '../score.js';

const surfaces = [
  { surfaceId: 'a', buildPriority: 'P1' },
  { surfaceId: 'b', buildPriority: 'P3' },
] as any;

describe('coverageScore', () => {
  it('all listed → 100', () => {
    expect(coverageScore([{ surfaceId: 'a', state: 'listed' }, { surfaceId: 'b', state: 'listed' }] as any, surfaces)).toBe(100);
  });
  it('all absent → 0', () => {
    expect(coverageScore([{ surfaceId: 'a', state: 'absent' }, { surfaceId: 'b', state: 'absent' }] as any, surfaces)).toBe(0);
  });
  it('wrong counts half (single P1 wrong → 50)', () => {
    expect(coverageScore([{ surfaceId: 'a', state: 'wrong' }] as any, surfaces)).toBe(50);
  });
  it('unknown is excluded from the denominator', () => {
    // a(P1) listed, b(P3) unknown → only a counts → 100
    expect(coverageScore([{ surfaceId: 'a', state: 'listed' }, { surfaceId: 'b', state: 'unknown' }] as any, surfaces)).toBe(100);
  });
  it('P1 weighs more than P3 (a listed, b absent → 75)', () => {
    expect(coverageScore([{ surfaceId: 'a', state: 'listed' }, { surfaceId: 'b', state: 'absent' }] as any, surfaces)).toBe(75);
  });
  it('empty results → 0', () => {
    expect(coverageScore([] as any, surfaces)).toBe(0);
  });
});
