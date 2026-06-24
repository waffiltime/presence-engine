import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db, closeDb } from './db.js';
import { canonicalRecords, approvalQueue } from './schema.js';
import { runApproved } from './submit/run.js';

const slug = process.argv[2];
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('submit-run.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('submit-run.js');

if (slug && invokedDirectly) {
  try {
    const [row] = await db.select().from(canonicalRecords).where(eq(canonicalRecords.slug, slug));
    if (!row) {
      console.error(`No record with slug "${slug}".`);
      process.exitCode = 1;
    } else {
      const approved = await db.select().from(approvalQueue)
        .where(and(eq(approvalQueue.recordId, row.recordId), eq(approvalQueue.status, 'approved')));
      console.log(`About to execute ${approved.length} approved action(s) for "${slug}".`);
      const results = await runApproved(row.recordId);
      const by = results.reduce((m, r) => { m[r.outcome] = (m[r.outcome] ?? 0) + 1; return m; }, {} as Record<string, number>);
      console.log(`Done: ${JSON.stringify(by)}`);
      console.log(`Prepared hand-offs remain visible via: npm run submit:review -- ${slug}`);
      process.exitCode = 0;
    }
  } catch (e) {
    console.error('submit:run failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
