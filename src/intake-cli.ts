import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { intakeRecord } from './record/intake.js';
import { closeDb } from './db.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run intake -- <path-to-record.json>');
  process.exitCode = 1;
  closeDb();
} else {
  try {
    const record = JSON.parse(readFileSync(path, 'utf-8'));
    const recordId = await intakeRecord(record);
    console.log(`Record ${recordId} (slug: ${record.subject.slug}) saved. Next: npm run audit -- ${record.subject.slug}`);
    process.exitCode = 0;
  } catch (e) {
    if (e instanceof SyntaxError) {
      console.error(`Could not parse JSON in "${path}": ${e.message}`);
    } else {
      console.error('Intake failed:', e instanceof Error ? e.message : e);
    }
    process.exitCode = 1;
  } finally {
    // Always close the DB; never process.exit() (it races libuv teardown — UV_HANDLE_CLOSING).
    closeDb();
  }
}
