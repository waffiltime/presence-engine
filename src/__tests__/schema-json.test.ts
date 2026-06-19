import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Ajv2020 as Ajv } from 'ajv/dist/2020.js';
import * as ajvFormats from 'ajv-formats';
// ajv-formats ships a CJS default export; under NodeNext ESM the real callable
// is at .default when the namespace wrapper is present.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormats = (ajvFormats as any).default as (ajv: Ajv) => void;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaPath = resolve(__dirname, '../../canonical-record.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

function baseRecord(): any {
  return {
    schema_version: '1.0',
    record_id: 'rec_test_0001',
    subject: { kind: 'ai_agent', canonical_name: 'Beacon', slug: 'beacon', lifecycle_status: 'live' },
  };
}

describe('canonical-record.schema.json', () => {
  it('validates a record WITH a disambiguation block', () => {
    const r = baseRecord();
    r.disambiguation = {
      official_domain: 'beacon.example.com',
      official_handles: ['github.com/exampleco/beacon'],
      category: 'AI agent / MCP server',
      must_match_any: ['MCP', 'AI agent'],
      negative_keywords: ['lighthouse', 'navigation light'],
    };
    expect(validate(r)).toBe(true);
  });

  it('requires disambiguation.official_domain when the block is present', () => {
    const r = baseRecord();
    r.disambiguation = { official_handles: ['github.com/exampleco/beacon'] };
    expect(validate(r)).toBe(false);
  });

  it('validates the schema-embedded example', () => {
    for (const ex of schema.examples ?? []) expect(validate(ex)).toBe(true);
  });
});
