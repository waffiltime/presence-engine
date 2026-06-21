import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, closeDb } from './db.js';
import { canonicalRecords } from './schema.js';
import { connectSurfaces } from './submit/connect.js';

const slug = process.argv[2];
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('submit-connect.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('submit-connect.js');

if (slug && invokedDirectly) {
  try {
    const [row] = await db.select().from(canonicalRecords).where(eq(canonicalRecords.slug, slug));
    if (!row) {
      console.error(`No record with slug "${slug}". Run intake first.`);
      process.exitCode = 1;
    } else {
      const summary = await connectSurfaces(row.recordId, row.kind);
      if (!summary.length) {
        console.log('No connectable surfaces for this project kind yet.');
      } else {
        console.log('=== Connection status ===');
        for (const s of summary) {
          const hint = s.state === 'connected' ? '' : `  → set ${s.envVar} (${s.mintUrl})`;
          console.log(`${s.state.padEnd(18)} ${s.surfaceId}${hint}`);
        }
      }
      process.exitCode = 0;
    }
  } catch (e) {
    console.error('submit:connect failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
