import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, closeDb } from './db.js';
import { canonicalRecords } from './schema.js';
import { planSubmissions } from './submit/plan.js';

const slug = process.argv[2];
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('submit-plan.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('submit-plan.js');

if (slug && invokedDirectly) {
  try {
    const [row] = await db.select().from(canonicalRecords).where(eq(canonicalRecords.slug, slug));
    if (!row) {
      console.error(`No record with slug "${slug}". Run intake first.`);
      process.exitCode = 1;
    } else {
      const n = await planSubmissions(row.recordId);
      console.log(`Planned ${n} new submission proposal(s). Review with: npm run submit:review -- ${slug}`);
      process.exitCode = 0;
    }
  } catch (e) {
    console.error('submit:plan failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
