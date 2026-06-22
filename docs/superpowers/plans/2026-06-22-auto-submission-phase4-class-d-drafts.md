# Auto-Submission — Phase 4: Class D (Drafts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover the community/social surfaces where promotion is human-judgment and auto-posting gets you banned (Hacker News Show HN, Reddit, dev.to, Lobsters/Indie Hackers, X/Twitter, Product Hunt) with a `draft` adapter that produces platform-appropriate post copy → `needs_human`, **never auto-posted**. Also route the remaining `draft_only` vendor-portal directory surfaces (G2, Capterra/GetApp, AlternativeTo, Slant/StackShare, BetaList, F-Droid) to the existing assisted-manual adapter so every `draft_only` surface is covered.

**Architecture:** A new `draftAdapter` matched to a set of social `surfaceId`s plugs into `SUBMIT_ADAPTERS`. `plan()` builds a deterministic, platform-shaped draft string from the canonical record (pure — no network, no LLM, so it is offline-safe and trivially testable). `execute()` returns `needs_human` and **has no network-write path** — the registry's "instant ban" warnings are honored structurally. The directory surfaces are added to the existing `thirdPartyFormAdapter`'s surface set.

**Tech Stack:** Same as Phases 1–3. Spec: `docs/superpowers/specs/2026-06-20-auto-submission-design.md`.

**Note (optional future enhancement, NOT in scope):** `execute()` could polish the templated draft via Claude (the `drafter` actor) when `ANTHROPIC_API_KEY` is set, mirroring `report.ts`. Phase 4 ships deterministic templates only — robust and key-free.

---

## File structure

- `src/submit/adapters/draft.ts` — NEW: `draftAdapter` for the social surfaces.
- `src/submit/adapters/third-party-form.ts` — MODIFY: add the 6 directory `draft_only` surfaceIds.
- `src/submit/registry.ts` — MODIFY: register `draftAdapter`.
- Tests: `src/__tests__/submit-draft.test.ts`, plus extensions to `submit-registry.test.ts` and `submit-third-party-form.test.ts`.

---

## Task 1: Draft adapter

**Files:** Create `src/submit/adapters/draft.ts`; test `src/__tests__/submit-draft.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { draftAdapter } from '../submit/adapters/draft.js';

const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'mcp server' },
  positioning: { one_liner: 'An example MCP server for discovery.' },
  links: { homepage: 'https://beacon.example.com', repository: 'https://github.com/exampleco/beacon' },
};

describe('draftAdapter', () => {
  it('matches the community/social draft surfaces', () => {
    for (const id of ['hacker-news-show-hn', 'reddit-relevant-subs', 'dev-to', 'lobsters-indie-hackers', 'x-twitter', 'product-hunt']) {
      expect(draftAdapter.matches({ surfaceId: id, name: id } as any)).toBe(true);
    }
  });

  it('does not match owned/third-party submit surfaces', () => {
    expect(draftAdapter.matches({ surfaceId: 'mcp-so', name: 'mcp.so' } as any)).toBe(false);
    expect(draftAdapter.matches({ surfaceId: 'github-repo-about-topics-readme-releases', name: 'GitHub' } as any)).toBe(false);
  });

  it('plan() builds a draft proposal with mechanism draft', () => {
    const p = draftAdapter.plan(record, { surfaceId: 'reddit-relevant-subs', name: 'Reddit (relevant subs)' } as any);
    expect(p.mechanism).toBe('draft');
    expect(String(p.payload.draft)).toContain('Beacon');
    expect(p.preview).toContain('Beacon');
  });

  it('plan() shapes a Show HN title for Hacker News', () => {
    const p = draftAdapter.plan(record, { surfaceId: 'hacker-news-show-hn', name: 'Hacker News (Show HN)' } as any);
    expect(String(p.payload.draft)).toMatch(/^Show HN: Beacon/);
  });

  it('plan() keeps an X/Twitter draft within 280 characters', () => {
    const p = draftAdapter.plan(record, { surfaceId: 'x-twitter', name: 'X / Twitter' } as any);
    expect(String(p.payload.draft).length).toBeLessThanOrEqual(280);
  });

  it('execute() never posts — returns needs_human', async () => {
    const surface = { surfaceId: 'reddit-relevant-subs', name: 'Reddit (relevant subs)' } as any;
    const p = draftAdapter.plan(record, surface);
    const r = await draftAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    expect(r.notes).toMatch(/post it yourself|never/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-draft.test.ts`. Expected: FAIL — `Cannot find module '../submit/adapters/draft.js'`.

- [ ] **Step 3: Implement `src/submit/adapters/draft.ts`**

```ts
import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

// Community/social surfaces where auto-promotion is banned/risky. We DRAFT post
// copy; a human reviews and posts it. There is intentionally NO network-write
// path here — these can never fire themselves.
const DRAFT_SURFACES = new Set([
  'hacker-news-show-hn',
  'reddit-relevant-subs',
  'dev-to',
  'lobsters-indie-hackers',
  'x-twitter',
  'product-hunt',
]);

function draftFor(surfaceId: string, record: any): string {
  const name = String(record?.subject?.canonical_name ?? record?.subject?.slug ?? 'the project');
  const oneLiner = String(record?.positioning?.one_liner ?? '');
  const homepage = String(record?.links?.homepage ?? '');
  const repo = String(record?.links?.repository ?? '');

  switch (surfaceId) {
    case 'hacker-news-show-hn':
      return `Show HN: ${name} – ${oneLiner}\n\n${homepage}\n\nWhat it is: ${oneLiner}\nRepo: ${repo}\n\n(Be ready to answer questions in the thread.)`;
    case 'x-twitter': {
      const base = `${name}: ${oneLiner}`;
      const withLink = `${base} ${homepage}`.trim();
      return withLink.length <= 280 ? withLink : `${base.slice(0, 279 - homepage.length - 2)}… ${homepage}`.trim();
    }
    case 'product-hunt':
      return `Tagline: ${name} — ${oneLiner}\n\nDescription:\n${oneLiner}\n${homepage}`;
    case 'dev-to':
      return `# Introducing ${name}\n\n${oneLiner}\n\nLink: ${homepage}\nSource: ${repo}\n\n(Write a short walkthrough of the problem it solves.)`;
    case 'reddit-relevant-subs':
    case 'lobsters-indie-hackers':
    default:
      return `Title: ${name} — ${oneLiner}\n\n${oneLiner}\n${homepage}\n\n(Post only in genuinely relevant communities; lead with the problem, not the pitch.)`;
  }
}

export const draftAdapter: SubmitAdapter = {
  matches: (s: Surface) => DRAFT_SURFACES.has(s.surfaceId),

  plan(record, surface): SubmitProposal {
    const draft = draftFor(surface.surfaceId, record);
    return { mechanism: 'draft', payload: { surfaceName: surface.name, draft }, preview: `Draft for ${surface.name}:\n\n${draft}` };
  },

  async execute(proposal, surface): Promise<SubmitResult> {
    const name = String((proposal.payload as any).surfaceName ?? surface.name);
    return { outcome: 'needs_human', notes: `Draft ready for ${name} — review and post it yourself. The tool never auto-posts here.` };
  },
};
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-draft.test.ts`. Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/adapters/draft.ts src/__tests__/submit-draft.test.ts
git commit -m "feat(submit): draft adapter for community/social surfaces (never auto-posts)"
```

---

## Task 2: Register the draft adapter

**Files:** Modify `src/submit/registry.ts`; extend `src/__tests__/submit-registry.test.ts`.

- [ ] **Step 1: Add a failing assertion** inside the `describe('submit adapter registry', ...)` block in `src/__tests__/submit-registry.test.ts`:

```ts
  it('routes community/social surfaces to the draft adapter', () => {
    for (const id of ['hacker-news-show-hn', 'reddit-relevant-subs', 'dev-to', 'x-twitter', 'product-hunt']) {
      const a = adapterFor({ surfaceId: id, name: id } as any);
      expect(a?.plan({ subject: {}, positioning: {}, links: {} } as any, { surfaceId: id, name: id } as any).mechanism).toBe('draft');
    }
  });
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-registry.test.ts`. Expected: FAIL (`adapterFor` returns undefined for these ids).

- [ ] **Step 3: Update `src/submit/registry.ts`** — add the import and append `draftAdapter` to the array:

```ts
import { draftAdapter } from './adapters/draft.js';
```

```ts
export const SUBMIT_ADAPTERS: SubmitAdapter[] = [
  a2aCardAdapter, x402Adapter, padXmlAdapter,
  githubRepoAdapter, npmListingAdapter, pypiListingAdapter,
  thirdPartyFormAdapter, draftAdapter,
];
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-registry.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/submit/registry.ts src/__tests__/submit-registry.test.ts
git commit -m "feat(submit): register draft adapter"
```

---

## Task 3: Cover the directory `draft_only` surfaces (assisted-manual)

**Files:** Modify `src/submit/adapters/third-party-form.ts`; extend `src/__tests__/submit-third-party-form.test.ts`.

The remaining `draft_only` surfaces are vendor-portal directories (claim/suggest a
profile), which fit the assisted-manual model — prepare the packet, a human submits.

- [ ] **Step 1: Add a failing assertion** to `src/__tests__/submit-third-party-form.test.ts` inside the `describe('thirdPartyFormAdapter', ...)` block:

```ts
  it('also covers the draft_only directory surfaces as assisted-manual', () => {
    for (const id of ['g2', 'capterra-getapp', 'alternativeto', 'slant-stackshare', 'betalist', 'f-droid']) {
      expect(thirdPartyFormAdapter.matches({ surfaceId: id, name: id } as any)).toBe(true);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-third-party-form.test.ts`. Expected: FAIL (these ids not yet in the set).

- [ ] **Step 3: Update `src/submit/adapters/third-party-form.ts`** — add the six ids to the `THIRD_PARTY_SURFACES` set so it reads:

```ts
const THIRD_PARTY_SURFACES = new Set([
  'mcp-so',
  'smithery-ai',
  'glama-ai-mcp',
  'awesome-mcp-servers-github',
  'saashub',
  'long-tail-ai-saas-directories-100s',
  // draft_only vendor-portal directories — claim/suggest a profile (assisted-manual)
  'g2',
  'capterra-getapp',
  'alternativeto',
  'slant-stackshare',
  'betalist',
  'f-droid',
]);
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-third-party-form.test.ts`. Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/adapters/third-party-form.ts src/__tests__/submit-third-party-form.test.ts
git commit -m "feat(submit): cover draft_only directory surfaces as assisted-manual"
```

---

## Task 4: Final verification + README

**Files:** Modify `README.md`.

- [ ] **Step 1: Full suite + typecheck** — Run `npx tsc --noEmit && npx vitest run`. Expected: tsc clean; all tests pass (Phase 3's 101 + the new Phase 4 tests).

- [ ] **Step 2: Update `README.md`** — in the "## Submitting (experimental)" section, append this paragraph at the end of the section (immediately before the next `##` heading):

```markdown
For community surfaces (Hacker News, Reddit, dev.to, Product Hunt, X), the tool
**drafts** post copy for you to review and post yourself — it never posts to these
on its own, because auto-promotion there is against the rules and gets projects
banned.
```

- [ ] **Step 3: Manual smoke (no commit)** — re-seed (prior tests wipe surfaces) and confirm a draft appears:

```
npm run seed
npm run intake -- data/example.json
npm run audit -- beacon
npm run submit:plan -- beacon
npm run submit:review -- beacon
```

Expected: among the pending previews, at least one is a `Draft for ...` community post (e.g. Reddit or Show HN). No crashes; exit 0.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(submit): note community surfaces are drafted, never auto-posted"
```

---

## Done criteria for Phase 4

- `npx vitest run` green (Phase 3 tests + new Phase 4 tests).
- `npx tsc --noEmit` clean.
- The 6 social surfaces route to `draftAdapter` (mechanism `draft`), and `execute()` returns `needs_human` with no network path.
- The 6 directory `draft_only` surfaces route to the assisted-manual adapter.
- Every `draft_only` surface in the registry now routes to an adapter.

After Phase 4, the only remaining work is the research-gated **Phase 2b** (Docker Hub + Hugging Face API writes) and **Phase 3b** (smithery API auto-submit, awesome-mcp `github_pr`, and the confidence gate that guards those create-type auto-submissions) — all of which require live API/repo verification via WebSearch/WebFetch.
