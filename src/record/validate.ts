import { Ajv2020 as Ajv } from 'ajv/dist/2020.js';
import * as ajvFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ajv-formats ships a CJS default; under NodeNext ESM the callable is at .default.
const addFormats = (ajvFormats as any).default as (ajv: Ajv) => void;

const __dirname = dirname(fileURLToPath(import.meta.url));
// validate.ts is in src/record/ → schema is two levels up at the repo root.
const schema = JSON.parse(
  readFileSync(join(__dirname, '../../canonical-record.schema.json'), 'utf-8'),
);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export function validateRecord(record: unknown): ValidationResult {
  if (validate(record)) return { ok: true };
  return {
    ok: false,
    errors: (validate.errors ?? []).map(e => `${e.instancePath || '/'} ${e.message}`),
  };
}
