import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const canonicalRecords = sqliteTable('canonical_records', {
  recordId: text('record_id').primaryKey(),
  kind: text('kind').notNull(),
  slug: text('slug').notNull(),
  lifecycleStatus: text('lifecycle_status').notNull(),
  systemStatus: text('system_status').notNull().default('draft'),
  schemaVersion: text('schema_version').notNull(),
  version: integer('version').notNull().default(1),
  body: text('body', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  kindIdx: index('cr_kind_idx').on(t.kind),
  slugIdx: index('cr_slug_idx').on(t.slug),
}));

export const recordVersions = sqliteTable('record_versions', {
  id: text('id').primaryKey(),
  recordId: text('record_id').notNull(),
  version: integer('version').notNull(),
  body: text('body', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => ({ recIdx: index('rv_record_idx').on(t.recordId) }));

export const surfaces = sqliteTable('surfaces', {
  surfaceId: text('surface_id').primaryKey(),
  name: text('name').notNull(),
  url: text('url'),
  surfaceType: text('surface_type').notNull(),
  relevantKinds: text('relevant_kinds', { mode: 'json' }).$type<string[]>().notNull(),
  monitor: text('monitor').notNull(),
  managePolicy: text('manage_policy').notNull(),
  manageMechanism: text('manage_mechanism'),
  feedDriven: integer('feed_driven', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  buildPriority: text('build_priority'),
});

export const mentions = sqliteTable('mentions', {
  mentionId: text('mention_id').primaryKey(),
  recordId: text('record_id').notNull(),
  surface: text('surface').notNull(),
  surfaceId: text('surface_id'),
  url: text('url'),
  excerpt: text('excerpt'),
  foundAt: text('found_at').notNull(),
  classification: text('classification'),
  sentiment: real('sentiment'),
  reachScore: real('reach_score'),
  velocityFlag: integer('velocity_flag', { mode: 'boolean' }).default(false),
  linkedClaimId: text('linked_claim_id'),
  status: text('status').notNull().default('new'),
  raw: text('raw', { mode: 'json' }),
}, (t) => ({
  recIdx: index('m_record_idx').on(t.recordId),
  statusIdx: index('m_status_idx').on(t.status),
}));

export const opportunities = sqliteTable('opportunities', {
  opportunityId: text('opportunity_id').primaryKey(),
  recordId: text('record_id').notNull(),
  type: text('type').notNull(),
  url: text('url'),
  summary: text('summary'),
  detectedAt: text('detected_at').notNull(),
  draft: text('draft'),
  draftStatus: text('draft_status').notNull().default('none'),
  status: text('status').notNull().default('open'),
  raw: text('raw', { mode: 'json' }),
}, (t) => ({ recIdx: index('o_record_idx').on(t.recordId) }));

export const provenanceLog = sqliteTable('provenance_log', {
  id: text('id').primaryKey(),
  recordId: text('record_id'),
  eventType: text('event_type').notNull(),
  actor: text('actor').notNull(),
  target: text('target'),
  detail: text('detail', { mode: 'json' }),
  createdAt: text('created_at').notNull(),
}, (t) => ({
  recIdx: index('pl_record_idx').on(t.recordId),
  typeIdx: index('pl_type_idx').on(t.eventType),
}));

// One row per audit run — holds the score + synthesized report blob.
export const auditRuns = sqliteTable('audit_runs', {
  auditId: text('audit_id').primaryKey(),
  recordId: text('record_id').notNull(),
  coverageScore: real('coverage_score').notNull(),
  report: text('report', { mode: 'json' }).notNull(),
  presence: text('presence', { mode: 'json' }).notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at').notNull(),
}, (t) => ({ recIdx: index('ar_record_idx').on(t.recordId) }));
