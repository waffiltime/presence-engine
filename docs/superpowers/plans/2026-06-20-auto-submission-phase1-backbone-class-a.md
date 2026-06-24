# Auto-Submission — Phase 1: Backbone + Class A (Manifests) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the submit pipeline backbone (approval queue, `SubmitAdapter` contract, planner, executor, and `submit:plan`/`review`/`run` commands) and wire it end-to-end for Class A manifest surfaces (A2A agent card, x402, PAD XML), which generate files with zero credential or network-write risk.

**Architecture:** A second linear pipeline parallel to the read-only audit, sharing the SQLite DB and append-only `provenance_log`. `submit:plan` reads the latest audit's presence results and enqueues proposals into `approval_queue`; `submit:review` approves/rejects them; `submit:run` executes approved proposals via the matching adapter. Manifest adapters generate a file under `out/<slug>/` and resolve to `needs_human` ("deploy this to your domain"). This is the foundation Phases 2–4 (Classes B/C/D) reuse.

**Tech Stack:** TypeScript/Node ESM · Drizzle + better-sqlite3 (WAL) · Vitest · ULID · ISO-text timestamps · JSON-as-text. Follows existing conventions in `src/audit.ts`, `src/log.ts`, `src/presence/check.ts`.

**Reference for the spec:** `docs/superpowers/specs/2026-06-20-auto-submission-design.md`.

---

## File structure

- `src/schema.ts` — MODIFY: add `approvalQueue` table.
- `migrations/` — NEW migration via `npm run generate`.
- `src/constants.ts` — already defines `ACTORS.publisher`; no change.
- `src/submit/types.ts` — NEW: `SubmitAdapter`, `SubmitProposal`, `SubmitResult`, `Mechanism`, `SubmitOutcome`.
- `src/submit/queue.ts` — NEW: enqueue, list-by-status, transition (with provenance) helpers.
- `src/submit/adapters/a2a-card.ts` — NEW: A2A agent card manifest adapter.
- `src/submit/adapters/x402.ts` — NEW: x402 manifest adapter.
- `src/submit/adapters/pad-xml.ts` — NEW: PAD XML manifest adapter.
- `src/submit/registry.ts` — NEW: ordered `SUBMIT_ADAPTERS` array + `adapterFor(surface)`.
- `src/submit/plan.ts` — NEW: `planSubmissions(recordId)` — gate, route, idempotency, enqueue.
- `src/submit/run.ts` — NEW: `runApproved(recordId)` — execute approved rows, write outcomes.
- `src/submit/review.ts` — NEW: `listForReview(recordId)`, `decide(id, decision)`.
- `src/submit-plan.ts`, `src/submit-review.ts`, `src/submit-run.ts` — NEW: CLI entrypoints.
- `package.json` — MODIFY: add `submit:plan` / `submit:review` / `submit:run` scripts.

**Out of scope for Phase 1** (later phases): `submit:connect` + `connection_status` (no Class A credentials), the confidence gate (no create-type third-party adapters yet), package/owned-channel/PR/draft adapters.

---

## Task 1: `approval_queue` table + migration

**Files:**
- Modify: `src/schema.ts` (append after `auditRuns`)
- Test: `src/__tests__/submit-queue.test.ts` (created in Task 3; schema verified there)

- [ ] **Step 1: Add the table to `src/schema.ts`**

Append at the end of the file:

```ts
// Proposed submissions awaiting human approval, then execution. status is mutable
// (like mentions/opportunities); the audit trail is the append-only provenance_log.
export const approvalQueue = sqliteTable('approval_queue', {
  id: text('id').primaryKey(),
  recordId: text('record_id').notNull(),
  surfaceId: text('surface_id').notNull(),
  managePolicy: text('manage_policy').notNull(),
  mechanism: text('mechanism').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  payloadHash: text('payload_hash').notNull(),
  preview: text('preview').notNull(),
  status: text('status').notNull().default('pending'),
  result: text('result', { mode: 'json' }),
  evidenceUrl: text('evidence_url'),
  createdAt: text('created_at').notNull(),
  decidedAt: text('decided_at'),
  executedAt: text('executed_at'),
}, (t) => ({
  recIdx: index('aq_record_idx').on(t.recordId),
  statusIdx: index('aq_status_idx').on(t.status),
}));
```

- [ ] **Step 2: Generate the migration**

Run: `npm run generate`
Expected: a new file under `migrations/` adding `approval_queue`; `migrations/meta/_journal.json` updated.

- [ ] **Step 3: Apply the migration to the local dev DB**

Run: `npm run migrate`
Expected: completes with no error.

- [ ] **Step 4: Commit**

```bash
git add src/schema.ts migrations/
git commit -m "feat(submit): add approval_queue table + migration"
```

---

## Task 2: `SubmitAdapter` contract

**Files:**
- Create: `src/submit/types.ts`
- Test: none (pure type declarations; exercised by adapter tests)

- [ ] **Step 1: Write the contract**

```ts
import type { Surface } from '../surfaces/resolve.js';

export type Mechanism = 'api' | 'github_pr' | 'manifest' | 'assisted_manual' | 'draft';

export type SubmitOutcome = 'submitted' | 'pending_external' | 'needs_human' | 'failed';

export interface SubmitProposal {
  mechanism: Mechanism;
  payload: Record<string, unknown>;
  preview: string;
}

export interface SubmitResult {
  outcome: SubmitOutcome;
  evidenceUrl?: string;
  notes?: string;
}

export interface SubmitAdapter {
  /** does this adapter own the given surface? */
  matches(surface: Surface): boolean;
  /** pure: build the proposal at plan time. No network, no credentials. */
  plan(record: any, surface: Surface): SubmitProposal;
  /** the ONLY place writes and credentials happen. */
  execute(proposal: SubmitProposal, surface: Surface): Promise<SubmitResult>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/submit/types.ts
git commit -m "feat(submit): SubmitAdapter contract"
```

---

## Task 3: Queue helpers

**Files:**
- Create: `src/submit/queue.ts`
- Test: `src/__tests__/submit-queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db.js';
import { approvalQueue, provenanceLog } from '../schema.js';
import { enqueue, listByStatus, transition } from '../submit/queue.js';
import { eq } from 'drizzle-orm';

describe('submit queue', () => {
  beforeEach(async () => {
    await db.delete(approvalQueue);
    await db.delete(provenanceLog);
  });

  it('enqueues a pending proposal and lists it by status', async () => {
    const id = await enqueue({
      recordId: 'rec1', surfaceId: 'a2a-agent-card-well-known-agent-json',
      managePolicy: 'autonomous', mechanism: 'manifest',
      payload: { a: 1 }, payloadHash: 'h1', preview: 'preview text',
    });
    expect(id).toBeTruthy();
    const pending = await listByStatus('rec1', 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].mechanism).toBe('manifest');
  });

  it('transition updates status, stamps a timestamp, and writes a provenance row', async () => {
    const id = await enqueue({
      recordId: 'rec1', surfaceId: 's1', managePolicy: 'autonomous',
      mechanism: 'manifest', payload: {}, payloadHash: 'h', preview: 'p',
    });
    await transition(id, 'approved', { recordId: 'rec1', surfaceId: 's1' });
    const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, id));
    expect(row.status).toBe('approved');
    expect(row.decidedAt).toBeTruthy();
    const log = await db.select().from(provenanceLog);
    expect(log).toHaveLength(1);
    expect(log[0].eventType).toBe('submit.approved');
    expect(log[0].actor).toBe('publisher');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/submit-queue.test.ts`
Expected: FAIL — `Cannot find module '../submit/queue.js'`.

- [ ] **Step 3: Implement `src/submit/queue.ts`**

```ts
import { ulid } from 'ulid';
import { and, eq } from 'drizzle-orm';
import { db } from '../db.js';
import { approvalQueue } from '../schema.js';
import { logEvent } from '../log.js';
import { ACTORS } from '../constants.js';

export interface EnqueueInput {
  recordId: string;
  surfaceId: string;
  managePolicy: string;
  mechanism: string;
  payload: unknown;
  payloadHash: string;
  preview: string;
}

export async function enqueue(input: EnqueueInput): Promise<string> {
  const id = ulid();
  await db.insert(approvalQueue).values({
    id,
    recordId: input.recordId,
    surfaceId: input.surfaceId,
    managePolicy: input.managePolicy,
    mechanism: input.mechanism,
    payload: input.payload,
    payloadHash: input.payloadHash,
    preview: input.preview,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function listByStatus(recordId: string, status: string) {
  return db.select().from(approvalQueue)
    .where(and(eq(approvalQueue.recordId, recordId), eq(approvalQueue.status, status)));
}

// 'decision' transitions stamp decidedAt; 'outcome' transitions stamp executedAt.
const DECISION = new Set(['approved', 'rejected']);

export async function transition(
  id: string,
  status: string,
  ctx: { recordId: string; surfaceId: string; result?: unknown; evidenceUrl?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status };
  if (DECISION.has(status)) patch.decidedAt = now;
  else patch.executedAt = now;
  if (ctx.result !== undefined) patch.result = ctx.result;
  if (ctx.evidenceUrl !== undefined) patch.evidenceUrl = ctx.evidenceUrl;
  await db.update(approvalQueue).set(patch).where(eq(approvalQueue.id, id));
  await logEvent({
    recordId: ctx.recordId,
    eventType: `submit.${status}`,
    actor: ACTORS.publisher,
    target: ctx.surfaceId,
    detail: { id, ...(ctx.evidenceUrl ? { evidenceUrl: ctx.evidenceUrl } : {}) },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/submit-queue.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/queue.ts src/__tests__/submit-queue.test.ts
git commit -m "feat(submit): approval_queue helpers (enqueue/list/transition + provenance)"
```

---

## Task 4: A2A agent card adapter

**Files:**
- Create: `src/submit/adapters/a2a-card.ts`
- Test: `src/__tests__/submit-a2a-card.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { a2aCardAdapter } from '../submit/adapters/a2a-card.js';
import { rm, readFile } from 'node:fs/promises';

const surface = { surfaceId: 'a2a-agent-card-well-known-agent-json', name: 'A2A Agent Card (/.well-known/agent.json)' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'example MCP server' },
  positioning: { one_liner: 'An example MCP server.' },
  links: { homepage: 'https://beacon.example.com', agent_endpoint: 'https://beacon.example.com/a2a' },
  disambiguation: { official_domain: 'beacon.example.com' },
};

describe('a2aCardAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('matches only the a2a card surface', () => {
    expect(a2aCardAdapter.matches(surface)).toBe(true);
    expect(a2aCardAdapter.matches({ surfaceId: 'mcp-so', name: 'mcp.so' } as any)).toBe(false);
  });

  it('plan() produces a manifest payload whose preview is the JSON file body', () => {
    const p = a2aCardAdapter.plan(record, surface);
    expect(p.mechanism).toBe('manifest');
    expect(p.payload.name).toBe('Beacon');
    expect(p.payload.url).toBe('https://beacon.example.com/a2a');
    expect(p.preview).toContain('"name": "Beacon"');
  });

  it('execute() writes the file under out/<slug> and returns needs_human with the hosted url', async () => {
    const p = a2aCardAdapter.plan(record, surface);
    const r = await a2aCardAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    expect(r.evidenceUrl).toBe('https://beacon.example.com/.well-known/agent.json');
    const written = await readFile('out/beacon/.well-known/agent.json', 'utf-8');
    expect(JSON.parse(written).name).toBe('Beacon');
    await rm('out/beacon', { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/submit-a2a-card.test.ts`
Expected: FAIL — `Cannot find module '../submit/adapters/a2a-card.js'`.

- [ ] **Step 3: Implement `src/submit/adapters/a2a-card.ts`**

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

// The A2A agent card derives deterministically from the canonical record. The
// payload IS the file body; we never POST it anywhere — the user hosts it.
function buildCard(record: any): Record<string, unknown> {
  return {
    name: record?.subject?.canonical_name ?? record?.subject?.slug ?? 'unknown',
    description: record?.positioning?.one_liner ?? '',
    url: record?.links?.agent_endpoint ?? record?.links?.homepage ?? '',
    provider: { organization: record?.disambiguation?.official_domain ?? '' },
    version: record?.attributes?.current_version ?? '1.0',
  };
}

export const a2aCardAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'a2a-agent-card-well-known-agent-json',

  plan(record, _surface): SubmitProposal {
    const body = buildCard(record);
    const preview = JSON.stringify(body, null, 2);
    return { mechanism: 'manifest', payload: { ...body, _slug: record?.subject?.slug, _path: '.well-known/agent.json' }, preview };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const slug = String(proposal.payload._slug ?? 'project');
    const relPath = String(proposal.payload._path ?? '.well-known/agent.json');
    const { _slug, _path, ...body } = proposal.payload as Record<string, unknown>;
    const outPath = `out/${slug}/${relPath}`;
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(body, null, 2), 'utf-8');
    const domain = String((body as any).provider?.organization ?? 'your-domain');
    return {
      outcome: 'needs_human',
      evidenceUrl: `https://${domain}/.well-known/agent.json`,
      notes: `Generated ${outPath}. Deploy it to your domain to go live.`,
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/submit-a2a-card.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/adapters/a2a-card.ts src/__tests__/submit-a2a-card.test.ts
git commit -m "feat(submit): A2A agent card manifest adapter (generate-then-host)"
```

---

## Task 5: x402 manifest adapter

**Files:**
- Create: `src/submit/adapters/x402.ts`
- Test: `src/__tests__/submit-x402.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { x402Adapter } from '../submit/adapters/x402.js';
import { rm, readFile } from 'node:fs/promises';

const surface = { surfaceId: 'x402-manifest-well-known-x402', name: 'x402 manifest (/.well-known/x402)' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon' },
  links: { agent_endpoint: 'https://beacon.example.com/a2a', well_known_x402: 'https://beacon.example.com/.well-known/x402' },
  disambiguation: { official_domain: 'beacon.example.com' },
};

describe('x402Adapter', () => {
  it('matches only the x402 surface', () => {
    expect(x402Adapter.matches(surface)).toBe(true);
    expect(x402Adapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
  });

  it('plan() builds a manifest payload with the endpoint', () => {
    const p = x402Adapter.plan(record, surface);
    expect(p.mechanism).toBe('manifest');
    expect(p.payload.endpoint).toBe('https://beacon.example.com/a2a');
  });

  it('execute() writes the file and returns needs_human', async () => {
    const p = x402Adapter.plan(record, surface);
    const r = await x402Adapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    const written = await readFile('out/beacon/.well-known/x402', 'utf-8');
    expect(JSON.parse(written).name).toBe('Beacon');
    await rm('out/beacon', { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/submit-x402.test.ts`
Expected: FAIL — `Cannot find module '../submit/adapters/x402.js'`.

- [ ] **Step 3: Implement `src/submit/adapters/x402.ts`**

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function buildManifest(record: any): Record<string, unknown> {
  return {
    name: record?.subject?.canonical_name ?? record?.subject?.slug ?? 'unknown',
    endpoint: record?.links?.agent_endpoint ?? '',
    x402Version: 1,
  };
}

export const x402Adapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'x402-manifest-well-known-x402',

  plan(record, _surface): SubmitProposal {
    const body = buildManifest(record);
    return {
      mechanism: 'manifest',
      payload: { ...body, _slug: record?.subject?.slug, _path: '.well-known/x402', _domain: record?.disambiguation?.official_domain },
      preview: JSON.stringify(body, null, 2),
    };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const slug = String(proposal.payload._slug ?? 'project');
    const relPath = String(proposal.payload._path ?? '.well-known/x402');
    const domain = String(proposal.payload._domain ?? 'your-domain');
    const { _slug, _path, _domain, ...body } = proposal.payload as Record<string, unknown>;
    const outPath = `out/${slug}/${relPath}`;
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(body, null, 2), 'utf-8');
    return {
      outcome: 'needs_human',
      evidenceUrl: `https://${domain}/.well-known/x402`,
      notes: `Generated ${outPath}. Deploy it to your domain to go live.`,
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/submit-x402.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/adapters/x402.ts src/__tests__/submit-x402.test.ts
git commit -m "feat(submit): x402 manifest adapter"
```

---

## Task 6: PAD XML adapter

**Files:**
- Create: `src/submit/adapters/pad-xml.ts`
- Test: `src/__tests__/submit-pad-xml.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { padXmlAdapter } from '../submit/adapters/pad-xml.js';
import { rm, readFile } from 'node:fs/promises';

const surface = { surfaceId: 'pad-friendly-portals-softpedia-sourceforge-majorgeeks-snapfiles-download3k', name: 'PAD-friendly portals' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon' },
  positioning: { one_liner: 'An example desktop app.' },
  links: { homepage: 'https://beacon.example.com' },
  attributes: { current_version: '2.1' },
};

describe('padXmlAdapter', () => {
  it('matches the PAD portals surface', () => {
    expect(padXmlAdapter.matches(surface)).toBe(true);
    expect(padXmlAdapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
  });

  it('plan() produces XML preview containing the program name and version', () => {
    const p = padXmlAdapter.plan(record, surface);
    expect(p.mechanism).toBe('manifest');
    expect(p.preview).toContain('<Program_Name>Beacon</Program_Name>');
    expect(p.preview).toContain('<Program_Version>2.1</Program_Version>');
  });

  it('execute() writes pad.xml and returns needs_human', async () => {
    const p = padXmlAdapter.plan(record, surface);
    const r = await padXmlAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    const written = await readFile('out/beacon/pad.xml', 'utf-8');
    expect(written).toContain('<Program_Name>Beacon</Program_Name>');
    await rm('out/beacon', { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/submit-pad-xml.test.ts`
Expected: FAIL — `Cannot find module '../submit/adapters/pad-xml.js'`.

- [ ] **Step 3: Implement `src/submit/adapters/pad-xml.ts`**

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildPad(record: any): string {
  const name = String(record?.subject?.canonical_name ?? record?.subject?.slug ?? 'unknown');
  const version = String(record?.attributes?.current_version ?? '1.0');
  const desc = String(record?.positioning?.one_liner ?? '');
  const url = String(record?.links?.homepage ?? '');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<XML_DIZ_INFO>',
    '  <Program_Info>',
    `    <Program_Name>${esc(name)}</Program_Name>`,
    `    <Program_Version>${esc(version)}</Program_Version>`,
    '  </Program_Info>',
    '  <Web_Info>',
    `    <Application_URLs><Application_Info_URL>${esc(url)}</Application_Info_URL></Application_URLs>`,
    '  </Web_Info>',
    '  <Program_Descriptions>',
    `    <English><Char_Desc_45>${esc(desc)}</Char_Desc_45></English>`,
    '  </Program_Descriptions>',
    '</XML_DIZ_INFO>',
  ].join('\n');
}

export const padXmlAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'pad-friendly-portals-softpedia-sourceforge-majorgeeks-snapfiles-download3k',

  plan(record, _surface): SubmitProposal {
    const xml = buildPad(record);
    return { mechanism: 'manifest', payload: { xml, _slug: record?.subject?.slug }, preview: xml };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const slug = String(proposal.payload._slug ?? 'project');
    const outPath = `out/${slug}/pad.xml`;
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, String(proposal.payload.xml), 'utf-8');
    return { outcome: 'needs_human', notes: `Generated ${outPath}. Host it and submit the PAD URL to the directories.` };
  },
};
```

> The `pad-friendly-portals-...` surfaceId is the slug of the registry row "PAD-friendly portals (Softpedia, SourceForge, MajorGeeks, SnapFiles, Download3k)". Verify it by running, after `npm run seed`:
> `node -e "import('./src/db.js').then(async ({db})=>{const {surfaces}=await import('./src/schema.js');console.log((await db.select().from(surfaces)).map(s=>s.surfaceId).filter(x=>x.includes('pad')));})"`
> If the slug differs, use the printed value in `matches` and the test.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/submit-pad-xml.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/adapters/pad-xml.ts src/__tests__/submit-pad-xml.test.ts
git commit -m "feat(submit): PAD XML manifest adapter"
```

---

## Task 7: Adapter registry

**Files:**
- Create: `src/submit/registry.ts`
- Test: `src/__tests__/submit-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { adapterFor } from '../submit/registry.js';

describe('submit adapter registry', () => {
  it('routes each manifest surface to its adapter', () => {
    expect(adapterFor({ surfaceId: 'a2a-agent-card-well-known-agent-json', name: 'A2A' } as any)?.plan).toBeTypeOf('function');
    expect(adapterFor({ surfaceId: 'x402-manifest-well-known-x402', name: 'x402' } as any)?.plan).toBeTypeOf('function');
  });

  it('returns undefined for a surface no adapter owns yet', () => {
    expect(adapterFor({ surfaceId: 'reddit-relevant-subs', name: 'Reddit' } as any)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/submit-registry.test.ts`
Expected: FAIL — `Cannot find module '../submit/registry.js'`.

- [ ] **Step 3: Implement `src/submit/registry.ts`**

```ts
import type { Surface } from '../surfaces/resolve.js';
import type { SubmitAdapter } from './types.js';
import { a2aCardAdapter } from './adapters/a2a-card.js';
import { x402Adapter } from './adapters/x402.js';
import { padXmlAdapter } from './adapters/pad-xml.js';

// No catch-all: a surface with no adapter is simply not actionable yet.
export const SUBMIT_ADAPTERS: SubmitAdapter[] = [a2aCardAdapter, x402Adapter, padXmlAdapter];

export function adapterFor(surface: Surface): SubmitAdapter | undefined {
  return SUBMIT_ADAPTERS.find(a => a.matches(surface));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/submit-registry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/registry.ts src/__tests__/submit-registry.test.ts
git commit -m "feat(submit): adapter registry + routing"
```

---

## Task 8: Planner

**Files:**
- Create: `src/submit/plan.ts`
- Test: `src/__tests__/submit-plan.test.ts`

The planner reads the latest `audit_runs.presence` for the record, resolves the
project's surfaces, applies the `managePolicy` gate (only `autonomous`/`draft_only`),
skips surfaces already `listed` (high confidence), routes via the registry, computes
a `payloadHash`, applies idempotency (skip if an open row with the same hash exists),
and enqueues `pending` proposals.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db.js';
import { approvalQueue, canonicalRecords, auditRuns, surfaces } from '../schema.js';
import { planSubmissions } from '../submit/plan.js';
import { ulid } from 'ulid';

const recordId = 'rec_plan_test';
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', kind: 'ai_agent' },
  positioning: { one_liner: 'x' },
  links: { agent_endpoint: 'https://beacon.example.com/a2a', homepage: 'https://beacon.example.com' },
  disambiguation: { official_domain: 'beacon.example.com' },
};

async function seedSurface(id: string, managePolicy: string) {
  await db.insert(surfaces).values({
    surfaceId: id, name: id, url: null, surfaceType: 'owned_manifest',
    relevantKinds: ['agent'], monitor: 'full', managePolicy, manageMechanism: null,
    feedDriven: true, notes: null, buildPriority: 'P1',
  }).onConflictDoNothing();
}

describe('planSubmissions', () => {
  beforeEach(async () => {
    await db.delete(approvalQueue);
    await db.delete(auditRuns);
    await db.delete(canonicalRecords);
    await db.delete(surfaces);
    await db.insert(canonicalRecords).values({
      recordId, kind: 'ai_agent', slug: 'beacon', lifecycleStatus: 'live', systemStatus: 'active',
      schemaVersion: '1.0', version: 1, body: record, createdAt: 'now', updatedAt: 'now',
    });
    await seedSurface('a2a-agent-card-well-known-agent-json', 'autonomous');
    await seedSurface('wikipedia', 'never');
  });

  it('enqueues a pending proposal for an autonomous manifest surface that is absent', async () => {
    await db.insert(auditRuns).values({
      auditId: ulid(), recordId, coverageScore: 0, report: {}, startedAt: 'a', finishedAt: 'b',
      presence: [{ surfaceId: 'a2a-agent-card-well-known-agent-json', state: 'absent', confidence: 'high' }],
    });
    const n = await planSubmissions(recordId);
    expect(n).toBe(1);
    const rows = await db.select().from(approvalQueue);
    expect(rows).toHaveLength(1);
    expect(rows[0].mechanism).toBe('manifest');
    expect(rows[0].status).toBe('pending');
  });

  it('never proposes a manage_policy=never surface', async () => {
    await db.insert(auditRuns).values({
      auditId: ulid(), recordId, coverageScore: 0, report: {}, startedAt: 'a', finishedAt: 'b',
      presence: [{ surfaceId: 'wikipedia', state: 'absent', confidence: 'high' }],
    });
    const n = await planSubmissions(recordId);
    expect(n).toBe(0);
    expect(await db.select().from(approvalQueue)).toHaveLength(0);
  });

  it('is idempotent: re-planning with no change enqueues nothing new', async () => {
    await db.insert(auditRuns).values({
      auditId: ulid(), recordId, coverageScore: 0, report: {}, startedAt: 'a', finishedAt: 'b',
      presence: [{ surfaceId: 'a2a-agent-card-well-known-agent-json', state: 'absent', confidence: 'high' }],
    });
    await planSubmissions(recordId);
    const n2 = await planSubmissions(recordId);
    expect(n2).toBe(0);
    expect(await db.select().from(approvalQueue)).toHaveLength(1);
  });

  it('throws a clear error when there is no audit to plan from', async () => {
    await expect(planSubmissions(recordId)).rejects.toThrow(/audit/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/submit-plan.test.ts`
Expected: FAIL — `Cannot find module '../submit/plan.js'`.

- [ ] **Step 3: Implement `src/submit/plan.ts`**

```ts
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db.js';
import { canonicalRecords, auditRuns, approvalQueue } from '../schema.js';
import { resolveSurfaces } from '../surfaces/resolve.js';
import { adapterFor } from './registry.js';
import { enqueue } from './queue.js';

const ACTIONABLE = new Set(['autonomous', 'draft_only']);
// Rows that mean "this surface already has a live or in-flight proposal".
const OPEN_STATUSES = ['pending', 'approved', 'submitted', 'pending_external', 'needs_human'];

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function planSubmissions(recordId: string): Promise<number> {
  const [rec] = await db.select().from(canonicalRecords).where(eq(canonicalRecords.recordId, recordId));
  if (!rec) throw new Error(`No record: ${recordId}`);

  const [latestAudit] = await db.select().from(auditRuns)
    .where(eq(auditRuns.recordId, recordId)).orderBy(desc(auditRuns.finishedAt)).limit(1);
  if (!latestAudit) throw new Error(`No audit found for ${recordId} — run the audit first.`);

  const presence = (latestAudit.presence as Array<{ surfaceId: string; state: string; confidence: string }>) ?? [];
  const presenceBy = new Map(presence.map(p => [p.surfaceId, p]));

  const record = rec.body as any;
  const surfaces = await resolveSurfaces(rec.kind);

  let enqueued = 0;
  for (const surface of surfaces) {
    if (!ACTIONABLE.has(surface.managePolicy)) continue;          // managePolicy gate
    const pres = presenceBy.get(surface.surfaceId);
    if (pres && pres.state === 'listed' && pres.confidence === 'high') continue; // already there

    const adapter = adapterFor(surface);
    if (!adapter) continue;                                       // no adapter → not actionable

    const proposal = adapter.plan(record, surface);
    const payloadHash = hashPayload(proposal.payload);

    const existing = await db.select().from(approvalQueue).where(and(
      eq(approvalQueue.recordId, recordId),
      eq(approvalQueue.surfaceId, surface.surfaceId),
      inArray(approvalQueue.status, OPEN_STATUSES),
    ));
    if (existing.some(r => r.payloadHash === payloadHash)) continue; // idempotency

    await enqueue({
      recordId, surfaceId: surface.surfaceId, managePolicy: surface.managePolicy,
      mechanism: proposal.mechanism, payload: proposal.payload, payloadHash, preview: proposal.preview,
    });
    enqueued++;
  }
  return enqueued;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/submit-plan.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/plan.ts src/__tests__/submit-plan.test.ts
git commit -m "feat(submit): planner — managePolicy gate, routing, idempotency"
```

---

## Task 9: Review helpers

**Files:**
- Create: `src/submit/review.ts`
- Test: `src/__tests__/submit-review.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db.js';
import { approvalQueue, provenanceLog } from '../schema.js';
import { enqueue } from '../submit/queue.js';
import { listForReview, decide } from '../submit/review.js';
import { eq } from 'drizzle-orm';

describe('submit review', () => {
  let id: string;
  beforeEach(async () => {
    await db.delete(approvalQueue);
    await db.delete(provenanceLog);
    id = await enqueue({
      recordId: 'rec1', surfaceId: 's1', managePolicy: 'autonomous',
      mechanism: 'manifest', payload: {}, payloadHash: 'h', preview: 'PREVIEW',
    });
  });

  it('lists pending items for review', async () => {
    const items = await listForReview('rec1');
    expect(items.pending).toHaveLength(1);
    expect(items.pending[0].preview).toBe('PREVIEW');
  });

  it('decide(approve) flips status to approved', async () => {
    await decide(id, 'approve');
    const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, id));
    expect(row.status).toBe('approved');
  });

  it('decide(reject) flips status to rejected', async () => {
    await decide(id, 'reject');
    const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, id));
    expect(row.status).toBe('rejected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/submit-review.test.ts`
Expected: FAIL — `Cannot find module '../submit/review.js'`.

- [ ] **Step 3: Implement `src/submit/review.ts`**

```ts
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db.js';
import { approvalQueue } from '../schema.js';
import { transition } from './queue.js';

export async function listForReview(recordId: string) {
  const pending = await db.select().from(approvalQueue)
    .where(and(eq(approvalQueue.recordId, recordId), eq(approvalQueue.status, 'pending')));
  // The persistent to-do view: prepared hand-offs that survive past submit:run.
  const todo = await db.select().from(approvalQueue)
    .where(and(eq(approvalQueue.recordId, recordId), inArray(approvalQueue.status, ['needs_human'])));
  return { pending, todo };
}

export async function decide(id: string, decision: 'approve' | 'reject'): Promise<void> {
  const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, id));
  if (!row) throw new Error(`No queue item: ${id}`);
  const status = decision === 'approve' ? 'approved' : 'rejected';
  await transition(id, status, { recordId: row.recordId, surfaceId: row.surfaceId });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/submit-review.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/review.ts src/__tests__/submit-review.test.ts
git commit -m "feat(submit): review helpers (list + approve/reject)"
```

---

## Task 10: Executor

**Files:**
- Create: `src/submit/run.ts`
- Test: `src/__tests__/submit-run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db.js';
import { approvalQueue, provenanceLog, surfaces } from '../schema.js';
import { enqueue, transition } from '../submit/queue.js';
import { runApproved } from '../submit/run.js';
import { eq } from 'drizzle-orm';

const SID = 'a2a-agent-card-well-known-agent-json';

describe('runApproved', () => {
  let id: string;
  beforeEach(async () => {
    await db.delete(approvalQueue);
    await db.delete(provenanceLog);
    await db.delete(surfaces);
    await db.insert(surfaces).values({
      surfaceId: SID, name: 'A2A', url: null, surfaceType: 'owned_manifest',
      relevantKinds: ['agent'], monitor: 'full', managePolicy: 'autonomous',
      manageMechanism: null, feedDriven: true, notes: null, buildPriority: 'P1',
    }).onConflictDoNothing();
    id = await enqueue({
      recordId: 'rec1', surfaceId: SID, managePolicy: 'autonomous', mechanism: 'manifest',
      payload: { name: 'Beacon', provider: { organization: 'beacon.example.com' }, _slug: 'beacon', _path: '.well-known/agent.json' },
      payloadHash: 'h', preview: 'p',
    });
  });

  it('executes only approved rows and records the outcome', async () => {
    await transition(id, 'approved', { recordId: 'rec1', surfaceId: SID });
    const results = await runApproved('rec1');
    expect(results).toHaveLength(1);
    const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, id));
    expect(row.status).toBe('needs_human'); // manifest → generate-then-host
    expect(row.executedAt).toBeTruthy();
    const { rm } = await import('node:fs/promises');
    await rm('out/beacon', { recursive: true, force: true });
  });

  it('leaves pending (un-approved) rows untouched', async () => {
    const results = await runApproved('rec1');
    expect(results).toHaveLength(0);
    const [row] = await db.select().from(approvalQueue).where(eq(approvalQueue.id, id));
    expect(row.status).toBe('pending');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/submit-run.test.ts`
Expected: FAIL — `Cannot find module '../submit/run.js'`.

- [ ] **Step 3: Implement `src/submit/run.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '../db.js';
import { approvalQueue, surfaces } from '../schema.js';
import { adapterFor } from './registry.js';
import { transition } from './queue.js';
import type { SubmitResult } from './types.js';

export async function runApproved(recordId: string): Promise<SubmitResult[]> {
  const approved = await db.select().from(approvalQueue)
    .where(and(eq(approvalQueue.recordId, recordId), eq(approvalQueue.status, 'approved')));

  const results: SubmitResult[] = [];
  for (const row of approved) {
    const [surface] = await db.select().from(surfaces).where(eq(surfaces.surfaceId, row.surfaceId));
    const adapter = surface ? adapterFor(surface) : undefined;
    if (!surface || !adapter) {
      await transition(row.id, 'failed', { recordId, surfaceId: row.surfaceId, result: { error: 'no adapter for surface' } });
      results.push({ outcome: 'failed', notes: 'no adapter' });
      continue;
    }
    try {
      const r = await adapter.execute({ mechanism: row.mechanism as any, payload: row.payload as any, preview: row.preview }, surface);
      await transition(row.id, r.outcome, { recordId, surfaceId: row.surfaceId, result: r, evidenceUrl: r.evidenceUrl });
      results.push(r);
    } catch (e: any) {
      // One bad surface never aborts the batch; the row stays recoverable.
      await transition(row.id, 'failed', { recordId, surfaceId: row.surfaceId, result: { error: e.message } });
      results.push({ outcome: 'failed', notes: e.message });
    }
  }
  return results;
}
```

> Note: a `failed` transition stamps `executedAt` (it is not in the DECISION set), which is the intended "we tried" semantics. Re-running `submit:run` re-attempts rows the operator re-approves; failed rows are left as `failed` for inspection (re-approve to retry).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/submit-run.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/run.ts src/__tests__/submit-run.test.ts
git commit -m "feat(submit): executor — run approved proposals, record outcomes"
```

---

## Task 11: CLI entrypoints + scripts

**Files:**
- Create: `src/submit-plan.ts`, `src/submit-review.ts`, `src/submit-run.ts`
- Modify: `package.json` (scripts)
- Test: none automated (CLIs are thin wrappers; logic is covered by Tasks 8–10). A manual smoke test is in Task 12.

- [ ] **Step 1: Implement `src/submit-plan.ts`**

```ts
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
```

- [ ] **Step 2: Implement `src/submit-review.ts`**

```ts
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
```

- [ ] **Step 3: Implement `src/submit-run.ts`**

```ts
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
      const by = results.reduce<Record<string, number>>((m, r) => { m[r.outcome] = (m[r.outcome] ?? 0) + 1; return m; }, {});
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
```

- [ ] **Step 4: Add scripts to `package.json`**

In the `"scripts"` block, after `"audit"`:

```json
    "submit:plan": "tsx src/submit-plan.ts",
    "submit:review": "tsx src/submit-review.ts",
    "submit:run": "tsx src/submit-run.ts",
```

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass (existing 55 + new submit tests).

- [ ] **Step 6: Commit**

```bash
git add src/submit-plan.ts src/submit-review.ts src/submit-run.ts package.json
git commit -m "feat(submit): submit:plan/review/run CLI entrypoints"
```

---

## Task 12: End-to-end smoke test (manual) + README

**Files:**
- Modify: `README.md` (document the submit commands)
- Modify: `.gitignore` (ignore the generated `out/` dir)

- [ ] **Step 1: Ignore generated artifacts**

Add to `.gitignore`:

```
out/
```

- [ ] **Step 2: Manual end-to-end run**

```bash
npm run seed                       # ensure surfaces are loaded
npm run intake -- data/example.json
npm run audit -- beacon            # produces presence the planner reads
npm run submit:plan -- beacon      # expect: "Planned N new submission proposal(s)."
npm run submit:review -- beacon    # expect: pending manifest previews printed
npm run submit:review -- beacon --approve-all
npm run submit:run -- beacon       # expect: Done: {"needs_human":N}; files under out/beacon/
```

Expected: `out/beacon/.well-known/agent.json` exists and contains the record-derived
card. Re-running `submit:plan -- beacon` prints "Planned 0" (idempotency).

- [ ] **Step 3: Document in `README.md`**

Under a new `## Submitting (experimental)` section after "Understanding the score":

```markdown
## Submitting (experimental)

The audit tells you where you're absent; the `submit:*` commands help you act on it.
Phase 1 covers self-hosted manifests (A2A agent card, x402, PAD XML) — generated
from your record, with a human approval gate, never auto-posted:

```bash
npm run submit:plan -- <slug>      # propose submissions from the latest audit
npm run submit:review -- <slug>    # inspect previews; --approve-all or --approve <id>
npm run submit:run -- <slug>       # generate approved artifacts into out/<slug>/
```

Manifest surfaces produce a file you deploy to your own domain; the next audit
confirms it went live. Credentialed (npm/GitHub/etc.) and third-party submissions
land in later phases.
```

- [ ] **Step 4: Commit**

```bash
git add README.md .gitignore
git commit -m "docs(submit): document Phase 1 submit commands; ignore out/"
```

---

## Done criteria for Phase 1

- `npx vitest run` green (existing 55 + new submit tests).
- `npx tsc --noEmit` clean.
- The manual end-to-end run in Task 12 generates `out/beacon/.well-known/agent.json`.
- Every queue transition has a matching `provenance_log` row.
- Re-running `submit:plan` after no change enqueues nothing (idempotency holds).

Phase 2 (Class B: GitHub/Docker/HF API + npm/PyPI assisted-manual, plus
`submit:connect` and `connection_status`) builds on this backbone and reuses the
`SubmitAdapter` contract, planner, queue, and CLIs unchanged.
