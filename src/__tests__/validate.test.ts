import { describe, it, expect } from 'vitest';
import { validateRecord } from '../record/validate.js';

function makeMinimalRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: '1.0',
    record_id: 'rec_test_0001',
    subject: { kind: 'ai_agent', canonical_name: 'Beacon', slug: 'beacon', lifecycle_status: 'live' },
    ...overrides,
  };
}

describe('validateRecord', () => {
  it('accepts a minimal valid record (subject only)', () => {
    expect(validateRecord(makeMinimalRecord())).toEqual({ ok: true });
  });

  it('accepts a record with links including package names', () => {
    const r = makeMinimalRecord({
      links: {
        homepage: 'https://beacon.example.com',
        repository: 'https://github.com/exampleco/beacon',
        npm_package: 'beacon-mcp',
        pypi_package: 'beacon-mcp',
      },
    });
    expect(validateRecord(r)).toEqual({ ok: true });
  });

  it('accepts optional docker_image and hf_model in links', () => {
    const r = makeMinimalRecord({
      links: { docker_image: 'exampleco/beacon', hf_model: 'exampleco/beacon' },
    });
    expect(validateRecord(r)).toEqual({ ok: true });
  });

  it('rejects removed commercial blocks (claims) via additionalProperties', () => {
    const r = makeMinimalRecord({ claims: [] });
    expect(validateRecord(r).ok).toBe(false);
  });

  it('rejects a record missing subject.kind, returning errors', () => {
    const r = makeMinimalRecord();
    delete (r.subject as Record<string, unknown>).kind;
    const result = validateRecord(r);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });
});
