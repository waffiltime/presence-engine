import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, closeDb } from './db.js';
import { canonicalRecords } from './schema.js';
import { listForReview, decide } from './submit/review.js';

const slug = process.argv[2];
const flag = process.argv[3]; // undefined | --approve | --reject | --approve-all
const targetId = process.argv[4];
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('submit-review.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('submit-review.js');

if (slug && invokedDirectly) {
  try {
    const [row] = await db.select().from(canonicalRecords).where(eq(canonicalRecords.slug, slug));
    if (!row) {
      console.error(`No record with slug "${slug}".`);
      process.exitCode = 1;
    } else {
      const { pending, todo } = await listForReview(row.recordId);
      if (flag === '--approve-all') {
        for (const p of pending) await decide(p.id, 'approve');
        console.log(`Approved ${pending.length} item(s). Execute with: npm run submit:run -- ${slug}`);
      } else if (flag === '--approve' && targetId) {
        await decide(targetId, 'approve');
        console.log(`Approved ${targetId}.`);
      } else if (flag === '--reject' && targetId) {
        await decide(targetId, 'reject');
        console.log(`Rejected ${targetId}.`);
      } else {
        console.log(`=== Pending (${pending.length}) ===`);
        for (const p of pending) console.log(`\n[${p.id}] ${p.surfaceId} (${p.mechanism})\n${p.preview}`);
        if (todo.length) {
          console.log(`\n=== Prepared, awaiting your action (${todo.length}) ===`);
          for (const t of todo) console.log(`[${t.id}] ${t.surfaceId}: ${(t.result as any)?.notes ?? ''} ${t.evidenceUrl ?? ''}`);
        }
        console.log(`\nApprove: npm run submit:review -- ${slug} --approve <id>   (or --approve-all)`);
      }
      process.exitCode = 0;
    }
  } catch (e) {
    console.error('submit:review failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
