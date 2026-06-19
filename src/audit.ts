import 'dotenv/config';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { db, closeDb } from './db.js';
import { canonicalRecords, auditRuns } from './schema.js';
import { resolveSurfaces } from './surfaces/resolve.js';
import { checkPresence } from './presence/check.js';
import { coverageScore } from './score.js';
import { buildReport, type AuditReport } from './report.js';
import { logEvent } from './log.js';
import { ACTORS } from './constants.js';

export async function runAudit(recordId: string): Promise<AuditReport> {
  const startedAt = new Date().toISOString();
  const [row] = await db.select().from(canonicalRecords).where(eq(canonicalRecords.recordId, recordId));
  if (!row) throw new Error(`No record: ${recordId}`);
  const record = row.body as any;

  const surfaces = await resolveSurfaces(row.kind);
  const presence = await checkPresence(record, surfaces);
  const score = coverageScore(presence, surfaces);
  const report = await buildReport(record.subject.canonical_name, score, presence);

  const auditId = ulid();
  const finishedAt = new Date().toISOString();
  await db.insert(auditRuns).values({
    auditId, recordId, coverageScore: score, report, presence, startedAt, finishedAt,
  });
  await logEvent({ recordId, eventType: 'audit.completed', actor: ACTORS.system, detail: { auditId, score } });
  return report;
}

// CLI: `npm run audit -- <slug>`
const slug = process.argv[2];
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('audit.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('audit.js');
if (slug && invokedDirectly) {
  try {
    const [row] = await db.select().from(canonicalRecords).where(eq(canonicalRecords.slug, slug));
    if (!row) {
      console.error(`No record with slug "${slug}". Run intake first.`);
      process.exitCode = 1;
    } else {
      const report = await runAudit(row.recordId);
      console.log(`\n=== Visibility Audit: ${slug} ===\nScore: ${report.score}/100\n\n${report.summary}\n`);
      report.actionPoints.forEach((a, i) => console.log(`${i + 1}. [${a.priority}] ${a.action} (${a.surfaceId})`));

      // Be honest about why a low score may be hollow: unset keys downgrade surfaces to 'unknown'.
      const notes: string[] = [];
      if (!process.env.BRAVE_SEARCH_API_KEY) notes.push("no BRAVE_SEARCH_API_KEY → registry surfaces are 'unknown' and excluded from the score");
      if (!process.env.ANTHROPIC_API_KEY) notes.push('no ANTHROPIC_API_KEY → templated report (no LLM synthesis)');
      if (notes.length) console.log(`\nNote: ${notes.join('; ')}.`);

      process.exitCode = 0;
    }
  } catch (e) {
    console.error('Audit failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    // Always close the DB; never process.exit() (it races libuv teardown — UV_HANDLE_CLOSING).
    closeDb();
  }
}
