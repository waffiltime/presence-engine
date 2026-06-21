# Auto-Submission — Phase 3: Class C (Third-Party, Assisted-Manual) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover every third-party registry/directory surface (`mcp.so`, `smithery.ai`, `glama.ai`, `awesome-mcp-servers`, `SaaSHub`, long-tail directories) with a single **assisted-manual** adapter that prepares a ready-to-submit packet (the field values + a note) and resolves to `needs_human`. Plus a small planner tidy-up so re-planning supersedes prior `failed` rows instead of accumulating them.

**Architecture:** One config-driven `thirdPartyFormAdapter` matched to a set of Class C `surfaceId`s plugs into the existing `SUBMIT_ADAPTERS` registry. It never touches the network — `plan()` builds the packet, `execute()` returns `needs_human`. The planner gains a one-line supersede of stale `failed` rows. No new tables, no new credentials.

**Tech Stack:** Same as Phases 1–2. Spec: `docs/superpowers/specs/2026-06-20-auto-submission-design.md`.

**Explicitly deferred (need live API/repo research — Phase 3b):** the `smithery.ai` self-serve **API** auto-submit, the `awesome-mcp-servers` **github_pr** fork→insert→PR flow, and the **confidence gate** that guards those create-type auto-submissions. In Phase 3 all of Class C is assisted-manual, so no auto-create exists to gate.

---

## File structure

- `src/submit/adapters/third-party-form.ts` — NEW: assisted-manual adapter for the Class C surfaces.
- `src/submit/registry.ts` — MODIFY: register it.
- `src/submit/plan.ts` — MODIFY: supersede stale `failed` rows before enqueueing.
- Tests: `src/__tests__/submit-third-party-form.test.ts`, plus extensions to `submit-registry.test.ts` and `submit-plan.test.ts`.

---

## Task 1: Third-party assisted-manual adapter

**Files:** Create `src/submit/adapters/third-party-form.ts`; test `src/__tests__/submit-third-party-form.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { thirdPartyFormAdapter } from '../submit/adapters/third-party-form.js';

const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'mcp server' },
  positioning: { one_liner: 'An example MCP server.' },
  links: { homepage: 'https://beacon.example.com', repository: 'https://github.com/exampleco/beacon' },
};

describe('thirdPartyFormAdapter', () => {
  it('matches the Class C third-party surfaces', () => {
    for (const id of ['mcp-so', 'smithery-ai', 'glama-ai-mcp', 'awesome-mcp-servers-github', 'saashub', 'long-tail-ai-saas-directories-100s']) {
      expect(thirdPartyFormAdapter.matches({ surfaceId: id, name: id } as any)).toBe(true);
    }
  });

  it('does not match owned/manifest surfaces', () => {
    expect(thirdPartyFormAdapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
    expect(thirdPartyFormAdapter.matches({ surfaceId: 'a2a-agent-card-well-known-agent-json', name: 'A2A' } as any)).toBe(false);
  });

  it('plan() builds an assisted_manual packet of the submission fields', () => {
    const surface = { surfaceId: 'mcp-so', name: 'mcp.so' } as any;
    const p = thirdPartyFormAdapter.plan(record, surface);
    expect(p.mechanism).toBe('assisted_manual');
    const fields = p.payload.fields as any;
    expect(fields.name).toBe('Beacon');
    expect(fields.description).toBe('An example MCP server.');
    expect(fields.repository).toBe('https://github.com/exampleco/beacon');
    expect(p.preview).toContain('mcp.so');
    expect(p.preview).toContain('Beacon');
  });

  it('execute() does no network and returns needs_human naming the surface', async () => {
    const surface = { surfaceId: 'saashub', name: 'SaaSHub' } as any;
    const p = thirdPartyFormAdapter.plan(record, surface);
    const r = await thirdPartyFormAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    expect(r.notes).toContain('SaaSHub');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-third-party-form.test.ts`. Expected: FAIL — `Cannot find module '../submit/adapters/third-party-form.js'`.

- [ ] **Step 3: Implement `src/submit/adapters/third-party-form.ts`**

```ts
import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

// Third-party registries/directories where submission is a per-site form or a
// human-reviewed process. We prepare the field packet; a human submits it. This
// is deliberately NOT auto-posting (no browser automation, no ToS/CAPTCHA risk).
const THIRD_PARTY_SURFACES = new Set([
  'mcp-so',
  'smithery-ai',
  'glama-ai-mcp',
  'awesome-mcp-servers-github',
  'saashub',
  'long-tail-ai-saas-directories-100s',
]);

function buildFields(record: any): Record<string, unknown> {
  return {
    name: record?.subject?.canonical_name ?? record?.subject?.slug ?? 'unknown',
    category: record?.subject?.category ?? '',
    description: record?.positioning?.one_liner ?? '',
    homepage: record?.links?.homepage ?? '',
    repository: record?.links?.repository ?? '',
  };
}

export const thirdPartyFormAdapter: SubmitAdapter = {
  matches: (s: Surface) => THIRD_PARTY_SURFACES.has(s.surfaceId),

  plan(record, surface): SubmitProposal {
    const fields = buildFields(record);
    const preview = `Submit to ${surface.name} (human step):\n${JSON.stringify(fields, null, 2)}`;
    return { mechanism: 'assisted_manual', payload: { surfaceName: surface.name, fields }, preview };
  },

  async execute(proposal, surface): Promise<SubmitResult> {
    const name = String((proposal.payload as any).surfaceName ?? surface.name);
    return { outcome: 'needs_human', notes: `Submit the prepared details to ${name} — see the preview for the exact fields.` };
  },
};
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-third-party-form.test.ts`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/adapters/third-party-form.ts src/__tests__/submit-third-party-form.test.ts
git commit -m "feat(submit): third-party assisted-manual adapter (Class C registries)"
```

---

## Task 2: Register the adapter

**Files:** Modify `src/submit/registry.ts`; extend `src/__tests__/submit-registry.test.ts`.

- [ ] **Step 1: Add a failing assertion** inside the existing `describe('submit adapter registry', ...)` block in `src/__tests__/submit-registry.test.ts`:

```ts
  it('routes Class C third-party surfaces to the assisted-manual adapter', () => {
    for (const id of ['mcp-so', 'smithery-ai', 'glama-ai-mcp', 'awesome-mcp-servers-github', 'saashub', 'long-tail-ai-saas-directories-100s']) {
      const a = adapterFor({ surfaceId: id, name: id } as any);
      expect(a?.plan({ subject: {}, links: {} } as any, { surfaceId: id, name: id } as any).mechanism).toBe('assisted_manual');
    }
  });
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-registry.test.ts`. Expected: FAIL (`adapterFor` returns undefined for these ids).

- [ ] **Step 3: Update `src/submit/registry.ts`** — add the import and append to the array:

```ts
import { thirdPartyFormAdapter } from './adapters/third-party-form.js';
```

and change the `SUBMIT_ADAPTERS` array to:

```ts
export const SUBMIT_ADAPTERS: SubmitAdapter[] = [
  a2aCardAdapter, x402Adapter, padXmlAdapter,
  githubRepoAdapter, npmListingAdapter, pypiListingAdapter,
  thirdPartyFormAdapter,
];
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-registry.test.ts`. Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/registry.ts src/__tests__/submit-registry.test.ts
git commit -m "feat(submit): register third-party assisted-manual adapter"
```

---

## Task 3: Planner — supersede stale `failed` rows on re-plan

**Files:** Modify `src/submit/plan.ts`; extend `src/__tests__/submit-plan.test.ts`.

A `failed` row is intentionally re-triable (it is outside `OPEN_STATUSES`, so the
idempotency check re-proposes it). Without cleanup, repeatedly planning a
perpetually-failing surface piles up `failed` rows. Before enqueueing a fresh
proposal, drop any prior `failed` row for the same `(recordId, surfaceId, payloadHash)`.
The append-only `provenance_log` still retains the history.

- [ ] **Step 1: Add a failing test** inside the `describe('planSubmissions', ...)` block in `src/__tests__/submit-plan.test.ts`:

```ts
  it('supersedes a prior failed row for the same surface+payload instead of piling up', async () => {
    await db.insert(auditRuns).values({
      auditId: ulid(), recordId, coverageScore: 0, report: {}, startedAt: 'a', finishedAt: 'b',
      presence: [{ surfaceId: 'a2a-agent-card-well-known-agent-json', state: 'absent', confidence: 'high' }],
    });
    // First plan → one pending row.
    await planSubmissions(recordId);
    let rows = await db.select().from(approvalQueue);
    expect(rows).toHaveLength(1);
    // Simulate a failed execution of that row.
    await db.update(approvalQueue).set({ status: 'failed' }).where(eq(approvalQueue.id, rows[0].id));
    // Re-plan → the failed row is superseded, leaving exactly one (new pending) row.
    const n = await planSubmissions(recordId);
    expect(n).toBe(1);
    rows = await db.select().from(approvalQueue);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
  });
```

Note: this test uses `eq` from `drizzle-orm`, which is already imported at the top of the test file. If it is not, add `import { eq } from 'drizzle-orm';`.

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-plan.test.ts`. Expected: the new test FAILS — re-plan inserts a second row, so the table has 2 rows (1 failed + 1 pending), not 1. The other planner tests still pass.

- [ ] **Step 3: Update `src/submit/plan.ts`** — in the per-surface loop, immediately BEFORE the `await enqueue({ ... })` call, insert:

```ts
    // Tidy: a prior failed attempt with this exact payload is being re-proposed —
    // drop it so the queue holds one row per (surface, payload), not a pile.
    await db.delete(approvalQueue).where(and(
      eq(approvalQueue.recordId, recordId),
      eq(approvalQueue.surfaceId, surface.surfaceId),
      eq(approvalQueue.status, 'failed'),
      eq(approvalQueue.payloadHash, payloadHash),
    ));
```

(`and`, `eq`, and `approvalQueue` are already imported in `plan.ts`.)

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-plan.test.ts`. Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/plan.ts src/__tests__/submit-plan.test.ts
git commit -m "fix(submit): supersede stale failed rows on re-plan (keep queue tidy)"
```

---

## Task 4: Final verification + README note

**Files:** Modify `README.md`.

- [ ] **Step 1: Full suite + typecheck** — Run `npx tsc --noEmit && npx vitest run`. Expected: tsc clean; all tests pass (Phase 2's 95 + the new Phase 3 tests).

- [ ] **Step 2: Update `README.md`** — in the "## Submitting (experimental)" section, after the existing paragraph that ends "Third-party registry submissions land in a later phase.", replace that closing sentence with:

```markdown
Third-party registries (mcp.so, smithery.ai, glama.ai, SaaSHub, awesome-mcp-servers,
and long-tail directories) are prepared as ready-to-submit packets you paste in —
the tool never auto-posts to a third-party site.
```

- [ ] **Step 3: Manual smoke (no commit)** — re-seed (prior tests wipe surfaces) and confirm a third-party packet is produced:

```
npm run seed
npm run intake -- data/example.json
npm run audit -- beacon
npm run submit:plan -- beacon
npm run submit:review -- beacon
```

Expected: among the pending previews, at least one names a third-party surface (e.g. `mcp-so` / `smithery-ai`) with a `Submit to ...` packet. No crashes; exit 0.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(submit): note third-party registries are prepared as assisted-manual packets"
```

---

## Done criteria for Phase 3

- `npx vitest run` green (Phase 2 tests + new Phase 3 tests).
- `npx tsc --noEmit` clean.
- All six Class C surfaces route to `thirdPartyFormAdapter` and produce an `assisted_manual` packet.
- Re-planning a failed surface leaves one row, not a pile.

Phase 3b (smithery API auto-submit, awesome-mcp github_pr, confidence gate) and Phase 4
(Class D drafts) build on this. Phase 3b requires live API/repo research via WebSearch/WebFetch.
