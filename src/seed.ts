import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { db } from './db.js';
import { surfaces } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Deterministic ID from the surface name → re-running the seed is idempotent
// (onConflictDoNothing on the PK actually skips the existing row; a fresh ULID
// per run would not). Registry names are unique, so slugs don't collide.
function slugifySurfaceId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

function manageColumnToPolicy(manage: string): string {
  const m = manage.toLowerCase();
  if (m.startsWith('autonomous')) return 'autonomous';
  if (m.startsWith('draft')) return 'draft_only';
  if (m.startsWith('never')) return 'never';
  return 'none';
}

function monitorColumnToValue(monitor: string): string {
  const m = monitor.toLowerCase();
  if (m === 'full') return 'full';
  if (m === 'partial') return 'partial';
  return 'no';
}

export async function seedSurfaces(): Promise<number> {
  // seed.ts is in src/, the CSV at the repo root → one level up, NOT two.
  const csvPath = join(__dirname, '../surface-registry.csv');
  const raw = readFileSync(csvPath, 'utf-8');

  // csv-parse handles quoted fields containing commas (the Notes column).
  const rows: Record<string, string>[] = parse(raw, {
    columns: true, skip_empty_lines: true, trim: true, relax_column_count: true,
  });

  const seenIds = new Set<string>();
  let count = 0;

  for (const row of rows) {
    const surfaceName = row['Surface'];
    if (!surfaceName) continue;

    const surfaceId = slugifySurfaceId(surfaceName);
    if (seenIds.has(surfaceId)) {
      console.warn(`Duplicate slug for "${surfaceName}" (${surfaceId}) — skipping`);
      continue;
    }
    seenIds.add(surfaceId);

    const relevantKinds = (row['Relevant kinds'] ?? '').split(',').map(k => k.trim()).filter(Boolean);
    const feedDriven = (row['Feed-driven?'] ?? '').toLowerCase() === 'yes';

    await db.insert(surfaces).values({
      surfaceId,
      name: surfaceName,
      url: null,
      surfaceType: (row['Type'] ?? 'unknown').toLowerCase().replace(/[\s/]+/g, '_'),
      relevantKinds,
      monitor: monitorColumnToValue(row['Monitor'] ?? ''),
      managePolicy: manageColumnToPolicy(row['Manage'] ?? ''),
      manageMechanism: row['Manage mechanism'] || null,
      feedDriven,
      notes: row['Notes / gotchas'] || null,
      buildPriority: row['Build priority'] || null,
    }).onConflictDoNothing();

    count++;
  }

  console.log(`Seeded ${count} surfaces`);
  return count;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('seed.ts') ||
    process.argv[1]?.replace(/\\/g, '/').endsWith('seed.js')) {
  seedSurfaces().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
