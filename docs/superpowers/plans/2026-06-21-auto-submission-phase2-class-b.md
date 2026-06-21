# Auto-Submission — Phase 2: Class B (Owned Channels) + Connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add credentialed owned-channel submission — a `submit:connect` command + `connection_status` table that verifies the user's `.env` tokens, the **GitHub repo** `api` adapter (updates topics/description/homepage on the repo the user owns), and **npm/PyPI** assisted-manual adapters (emit the exact `package.json`/metadata change for the user to publish). Reuses the Phase 1 backbone (`SubmitAdapter`, planner, queue, review, executor) unchanged except for one correctness fix to the planner.

**Architecture:** Class B adapters plug into the existing `SUBMIT_ADAPTERS` registry. `api` adapters perform authenticated writes in `execute()` only (credentials loaded there, never at plan time). The planner gains an "update-in-place" exemption so owned-channel `api` surfaces are proposed even when presence says `listed` (you always may want to refresh metadata); payload-hash idempotency still prevents redundant updates. `submit:connect` verifies tokens via a cheap authenticated read and records `connection_status`.

**Tech Stack:** Same as Phase 1 — TypeScript/Node ESM, Drizzle + better-sqlite3, Vitest, ULID. Spec: `docs/superpowers/specs/2026-06-20-auto-submission-design.md`.

**Scope note — deferred to a later Phase 2b:** Docker Hub and Hugging Face `api` adapters. Their write APIs require multi-step auth (Docker Hub JWT login; HF Hub commit API) that should be specified against current docs, not guessed. They are `autonomous` in the registry and will route to the web-search/no adapter until 2b; nothing here blocks them.

---

## File structure

- `src/schema.ts` — MODIFY: add `connectionStatus` table (and import `primaryKey`).
- `migrations/` — NEW migration via `npm run generate`.
- `src/submit/credentials.ts` — NEW: `CREDENTIAL_SPECS` mapping surfaceId → `{ envVar, verify, mintUrl }`.
- `src/submit/connect.ts` — NEW: `connectSurfaces(recordId, kind)` — verify tokens, upsert `connection_status`.
- `src/submit/adapters/github-repo.ts` — NEW: GitHub repo `api` adapter.
- `src/submit/adapters/npm-listing.ts` — NEW: npm assisted-manual adapter.
- `src/submit/adapters/pypi-listing.ts` — NEW: PyPI assisted-manual adapter.
- `src/submit/registry.ts` — MODIFY: register the three new adapters.
- `src/submit/plan.ts` — MODIFY: update-in-place exemption from skip-if-listed.
- `src/submit-connect.ts` — NEW: CLI entrypoint.
- `package.json` — MODIFY: add `submit:connect` script.
- `.env.example` — MODIFY: document `GITHUB_TOKEN` already there; no new required keys for Phase 2 (npm/PyPI are assisted-manual, GitHub reuses `GITHUB_TOKEN`).
- `README.md` — MODIFY: document `submit:connect` and Class B.

---

## Task 1: `connection_status` table + migration

**Files:** Modify `src/schema.ts`; generate+apply migration.

- [ ] **Step 1: Add the table to `src/schema.ts`**

The file imports from `drizzle-orm/sqlite-core`. Add `primaryKey` to that import line (it currently imports `sqliteTable, text, integer, real, index`). Then append at the end of the file:

```ts
// Per-(record,surface) credential connection state, set by `submit:connect`.
// The token itself NEVER lands here — only whether it verified.
export const connectionStatus = sqliteTable('connection_status', {
  recordId: text('record_id').notNull(),
  surfaceId: text('surface_id').notNull(),
  state: text('state').notNull(),               // connected | missing | invalid | present_unverified
  lastVerifiedAt: text('last_verified_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.recordId, t.surfaceId] }),
}));
```

- [ ] **Step 2: Generate the migration** — Run `npm run generate`. Expected: a new file under `migrations/` creating `connection_status`.
- [ ] **Step 3: Apply it** — Run `npm run migrate`. Expected: completes, no error.
- [ ] **Step 4: Commit**

```bash
git add src/schema.ts migrations/
git commit -m "feat(submit): add connection_status table + migration"
```

---

## Task 2: Credential specs

**Files:** Create `src/submit/credentials.ts`. Test: covered via Task 3 (connect) tests.

- [ ] **Step 1: Implement `src/submit/credentials.ts`**

```ts
// Maps a manageable surface to the .env token it needs and how to cheaply verify
// that token. verify() does ONE authenticated read and returns true if the token
// is valid. Throwing (network/no endpoint) is treated as "present but unverified".
export interface CredentialSpec {
  surfaceId: string;
  envVar: string;
  mintUrl: string;
  verify: (token: string) => Promise<boolean>;
}

export const CREDENTIAL_SPECS: CredentialSpec[] = [
  {
    surfaceId: 'github-repo-about-topics-readme-releases',
    envVar: 'GITHUB_TOKEN',
    mintUrl: 'https://github.com/settings/tokens',
    async verify(token: string): Promise<boolean> {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'presence-engine', Accept: 'application/vnd.github+json' },
      });
      return res.status === 200;
    },
  },
];

export function credentialSpecFor(surfaceId: string): CredentialSpec | undefined {
  return CREDENTIAL_SPECS.find(c => c.surfaceId === surfaceId);
}
```

- [ ] **Step 2: Typecheck** — Run `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 3: Commit**

```bash
git add src/submit/credentials.ts
git commit -m "feat(submit): credential specs (env var + verify) for connectable surfaces"
```

---

## Task 3: `submit:connect` logic

**Files:** Create `src/submit/connect.ts`; test `src/__tests__/submit-connect.test.ts`.

`connectSurfaces` resolves the record's surfaces, keeps those with a `CredentialSpec`,
reads each token from `process.env`, classifies it (`missing` / `connected` /
`invalid` / `present_unverified`), and upserts a `connection_status` row.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db.js';
import { connectionStatus, surfaces } from '../schema.js';
import { connectSurfaces } from '../submit/connect.js';
import { eq } from 'drizzle-orm';

const GH = 'github-repo-about-topics-readme-releases';

async function seedGithub() {
  await db.insert(surfaces).values({
    surfaceId: GH, name: 'GitHub repo', url: null, surfaceType: 'owned_channel',
    relevantKinds: ['agent'], monitor: 'full', managePolicy: 'autonomous',
    manageMechanism: null, feedDriven: true, notes: null, buildPriority: 'P1',
  }).onConflictDoNothing();
}

describe('connectSurfaces', () => {
  beforeEach(async () => {
    await db.delete(connectionStatus);
    await db.delete(surfaces);
    await seedGithub();
    vi.unstubAllEnvs();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('records missing when the token env var is unset', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const summary = await connectSurfaces('rec1', 'ai_agent');
    expect(summary.find(s => s.surfaceId === GH)?.state).toBe('missing');
    const [row] = await db.select().from(connectionStatus).where(eq(connectionStatus.surfaceId, GH));
    expect(row.state).toBe('missing');
  });

  it('records connected when the token verifies', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    const summary = await connectSurfaces('rec1', 'ai_agent');
    expect(summary.find(s => s.surfaceId === GH)?.state).toBe('connected');
  });

  it('records invalid when the token fails verification', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'bad');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401 }));
    const summary = await connectSurfaces('rec1', 'ai_agent');
    expect(summary.find(s => s.surfaceId === GH)?.state).toBe('invalid');
  });

  it('records present_unverified when verification throws', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const summary = await connectSurfaces('rec1', 'ai_agent');
    expect(summary.find(s => s.surfaceId === GH)?.state).toBe('present_unverified');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-connect.test.ts`. Expected: FAIL — `Cannot find module '../submit/connect.js'`.

- [ ] **Step 3: Implement `src/submit/connect.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '../db.js';
import { connectionStatus } from '../schema.js';
import { resolveSurfaces } from '../surfaces/resolve.js';
import { credentialSpecFor } from './credentials.js';

export interface ConnectionSummaryItem {
  surfaceId: string;
  envVar: string;
  state: 'connected' | 'missing' | 'invalid' | 'present_unverified';
  mintUrl: string;
}

async function upsert(recordId: string, surfaceId: string, state: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.select().from(connectionStatus)
    .where(and(eq(connectionStatus.recordId, recordId), eq(connectionStatus.surfaceId, surfaceId)));
  if (existing.length) {
    await db.update(connectionStatus).set({ state, lastVerifiedAt: now })
      .where(and(eq(connectionStatus.recordId, recordId), eq(connectionStatus.surfaceId, surfaceId)));
  } else {
    await db.insert(connectionStatus).values({ recordId, surfaceId, state, lastVerifiedAt: now });
  }
}

export async function connectSurfaces(recordId: string, kind: string): Promise<ConnectionSummaryItem[]> {
  const surfaces = await resolveSurfaces(kind);
  const summary: ConnectionSummaryItem[] = [];
  for (const surface of surfaces) {
    const spec = credentialSpecFor(surface.surfaceId);
    if (!spec) continue;
    const token = process.env[spec.envVar];
    let state: ConnectionSummaryItem['state'];
    if (!token) {
      state = 'missing';
    } else {
      try {
        state = (await spec.verify(token)) ? 'connected' : 'invalid';
      } catch {
        state = 'present_unverified';
      }
    }
    await upsert(recordId, surface.surfaceId, state);
    summary.push({ surfaceId: surface.surfaceId, envVar: spec.envVar, state, mintUrl: spec.mintUrl });
  }
  return summary;
}
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-connect.test.ts`. Expected: PASS (4 tests).
- [ ] **Step 5: Commit**

```bash
git add src/submit/connect.ts src/__tests__/submit-connect.test.ts
git commit -m "feat(submit): connectSurfaces — verify .env tokens, record connection_status"
```

---

## Task 4: GitHub repo `api` adapter

**Files:** Create `src/submit/adapters/github-repo.ts`; test `src/__tests__/submit-github-repo.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { githubRepoAdapter } from '../submit/adapters/github-repo.js';

const surface = { surfaceId: 'github-repo-about-topics-readme-releases', name: 'GitHub repo' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'mcp server' },
  positioning: { one_liner: 'An example MCP server.' },
  links: { homepage: 'https://beacon.example.com', repository: 'https://github.com/exampleco/beacon' },
};

describe('githubRepoAdapter', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('matches only the github repo surface', () => {
    expect(githubRepoAdapter.matches(surface)).toBe(true);
    expect(githubRepoAdapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
  });

  it('plan() builds an api payload with description, homepage, and parsed owner/repo', () => {
    const p = githubRepoAdapter.plan(record, surface);
    expect(p.mechanism).toBe('api');
    expect(p.payload.owner).toBe('exampleco');
    expect(p.payload.repo).toBe('beacon');
    expect(p.payload.description).toBe('An example MCP server.');
    expect(p.payload.homepage).toBe('https://beacon.example.com');
    expect(p.preview).toContain('exampleco/beacon');
  });

  it('execute() without GITHUB_TOKEN returns failed', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const p = githubRepoAdapter.plan(record, surface);
    const r = await githubRepoAdapter.execute(p, surface);
    expect(r.outcome).toBe('failed');
    expect(r.notes).toMatch(/GITHUB_TOKEN/);
  });

  it('execute() PATCHes metadata + PUTs topics and returns submitted on success', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'tok');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 200, json: () => Promise.resolve({ html_url: 'https://github.com/exampleco/beacon' }) }) // PATCH repo
      .mockResolvedValueOnce({ status: 200, json: () => Promise.resolve({}) }); // PUT topics
    vi.stubGlobal('fetch', fetchMock);
    const p = githubRepoAdapter.plan(record, surface);
    const r = await githubRepoAdapter.execute(p, surface);
    expect(r.outcome).toBe('submitted');
    expect(r.evidenceUrl).toBe('https://github.com/exampleco/beacon');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('execute() returns failed when the GitHub API errors', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 403, json: () => Promise.resolve({}) }));
    const p = githubRepoAdapter.plan(record, surface);
    const r = await githubRepoAdapter.execute(p, surface);
    expect(r.outcome).toBe('failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-github-repo.test.ts`. Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/submit/adapters/github-repo.ts`**

```ts
import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function parseRepo(record: any): { owner: string; repo: string } | undefined {
  const url: string | undefined = record?.links?.repository;
  if (!url) return undefined;
  const m = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return undefined;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

function deriveTopics(record: any): string[] {
  const out = new Set<string>();
  const cat: string | undefined = record?.subject?.category;
  if (cat) for (const w of cat.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) out.add(w);
  for (const k of record?.disambiguation?.must_match_any ?? []) {
    const t = String(k).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (t) out.add(t);
  }
  return [...out].slice(0, 20); // GitHub allows up to 20 topics
}

export const githubRepoAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'github-repo-about-topics-readme-releases',

  plan(record, _surface): SubmitProposal {
    const parsed = parseRepo(record);
    const payload = {
      owner: parsed?.owner ?? '',
      repo: parsed?.repo ?? '',
      description: record?.positioning?.one_liner ?? '',
      homepage: record?.links?.homepage ?? '',
      topics: deriveTopics(record),
    };
    const preview = parsed
      ? `Update ${payload.owner}/${payload.repo}:\n  description: ${payload.description}\n  homepage: ${payload.homepage}\n  topics: ${payload.topics.join(', ')}`
      : 'No GitHub repository link declared — cannot update.';
    return { mechanism: 'api', payload, preview };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return { outcome: 'failed', notes: 'no GITHUB_TOKEN set — run submit:connect' };
    const { owner, repo, description, homepage, topics } = proposal.payload as {
      owner: string; repo: string; description: string; homepage: string; topics: string[];
    };
    if (!owner || !repo) return { outcome: 'failed', notes: 'no GitHub repository link declared' };

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'presence-engine',
      'Content-Type': 'application/json',
    };
    const patch = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      method: 'PATCH', headers, body: JSON.stringify({ description, homepage }),
    });
    if (patch.status !== 200) return { outcome: 'failed', notes: `GitHub PATCH returned ${patch.status}` };
    const data = (await patch.json()) as { html_url?: string };

    const put = await fetch(`https://api.github.com/repos/${owner}/${repo}/topics`, {
      method: 'PUT', headers, body: JSON.stringify({ names: topics }),
    });
    if (put.status !== 200) return { outcome: 'failed', notes: `GitHub topics PUT returned ${put.status}` };

    return { outcome: 'submitted', evidenceUrl: data.html_url ?? `https://github.com/${owner}/${repo}`, notes: 'updated repo metadata + topics' };
  },
};
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-github-repo.test.ts`. Expected: PASS (5 tests).
- [ ] **Step 5: Commit**

```bash
git add src/submit/adapters/github-repo.ts src/__tests__/submit-github-repo.test.ts
git commit -m "feat(submit): GitHub repo api adapter (description/homepage/topics)"
```

---

## Task 5: npm assisted-manual adapter

**Files:** Create `src/submit/adapters/npm-listing.ts`; test `src/__tests__/submit-npm-listing.test.ts`.

npm's published listing IS its `package.json` + tarball; there is no API to edit a
published package's metadata without republishing. So this adapter prepares the
exact `package.json` fields for the user to apply and publish, and resolves to
`needs_human`. No network.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { npmListingAdapter } from '../submit/adapters/npm-listing.js';

const surface = { surfaceId: 'npm', name: 'npm' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'mcp server' },
  positioning: { one_liner: 'An example MCP server.' },
  links: { homepage: 'https://beacon.example.com', repository: 'https://github.com/exampleco/beacon', npm_package: 'beacon-mcp' },
};

describe('npmListingAdapter', () => {
  it('matches only the npm surface', () => {
    expect(npmListingAdapter.matches(surface)).toBe(true);
    expect(npmListingAdapter.matches({ surfaceId: 'pypi', name: 'PyPI' } as any)).toBe(false);
  });

  it('plan() builds an assisted_manual payload of package.json fields', () => {
    const p = npmListingAdapter.plan(record, surface);
    expect(p.mechanism).toBe('assisted_manual');
    expect((p.payload.fields as any).description).toBe('An example MCP server.');
    expect((p.payload.fields as any).homepage).toBe('https://beacon.example.com');
    expect(p.preview).toContain('package.json');
  });

  it('execute() does no network and returns needs_human', async () => {
    const p = npmListingAdapter.plan(record, surface);
    const r = await npmListingAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    expect(r.notes).toMatch(/publish/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-npm-listing.test.ts`. Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/submit/adapters/npm-listing.ts`**

```ts
import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function keywords(record: any): string[] {
  const out = new Set<string>();
  const cat: string | undefined = record?.subject?.category;
  if (cat) for (const w of cat.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) out.add(w);
  return [...out];
}

export const npmListingAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'npm',

  plan(record, _surface): SubmitProposal {
    const fields = {
      description: record?.positioning?.one_liner ?? '',
      homepage: record?.links?.homepage ?? '',
      repository: record?.links?.repository ?? '',
      keywords: keywords(record),
    };
    const pkg = record?.links?.npm_package ?? '(your package)';
    const preview = `Set these fields in package.json for ${pkg}, then \`npm publish\`:\n${JSON.stringify(fields, null, 2)}`;
    return { mechanism: 'assisted_manual', payload: { package: pkg, fields }, preview };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const pkg = String((proposal.payload as any).package ?? 'your package');
    return { outcome: 'needs_human', notes: `Apply the package.json changes for ${pkg} and run npm publish to update the listing.` };
  },
};
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-npm-listing.test.ts`. Expected: PASS (3 tests).
- [ ] **Step 5: Commit**

```bash
git add src/submit/adapters/npm-listing.ts src/__tests__/submit-npm-listing.test.ts
git commit -m "feat(submit): npm assisted-manual adapter (package.json diff → publish)"
```

---

## Task 6: PyPI assisted-manual adapter

**Files:** Create `src/submit/adapters/pypi-listing.ts`; test `src/__tests__/submit-pypi-listing.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { pypiListingAdapter } from '../submit/adapters/pypi-listing.js';

const surface = { surfaceId: 'pypi', name: 'PyPI' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'mcp server' },
  positioning: { one_liner: 'An example MCP server.' },
  links: { homepage: 'https://beacon.example.com', pypi_package: 'beacon' },
};

describe('pypiListingAdapter', () => {
  it('matches only the pypi surface', () => {
    expect(pypiListingAdapter.matches(surface)).toBe(true);
    expect(pypiListingAdapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
  });

  it('plan() builds an assisted_manual payload of project metadata', () => {
    const p = pypiListingAdapter.plan(record, surface);
    expect(p.mechanism).toBe('assisted_manual');
    expect((p.payload.fields as any).description).toBe('An example MCP server.');
    expect(p.preview).toContain('pyproject.toml');
  });

  it('execute() does no network and returns needs_human', async () => {
    const p = pypiListingAdapter.plan(record, surface);
    const r = await pypiListingAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    expect(r.notes).toMatch(/release|publish/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-pypi-listing.test.ts`. Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/submit/adapters/pypi-listing.ts`**

```ts
import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

export const pypiListingAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'pypi',

  plan(record, _surface): SubmitProposal {
    const fields = {
      description: record?.positioning?.one_liner ?? '',
      homepage: record?.links?.homepage ?? '',
      repository: record?.links?.repository ?? '',
    };
    const pkg = record?.links?.pypi_package ?? '(your package)';
    const preview = `Set these in pyproject.toml [project] for ${pkg}, then publish a new release:\n${JSON.stringify(fields, null, 2)}`;
    return { mechanism: 'assisted_manual', payload: { package: pkg, fields }, preview };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const pkg = String((proposal.payload as any).package ?? 'your package');
    return { outcome: 'needs_human', notes: `Apply the pyproject.toml changes for ${pkg} and publish a new release to update the listing.` };
  },
};
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-pypi-listing.test.ts`. Expected: PASS (3 tests).
- [ ] **Step 5: Commit**

```bash
git add src/submit/adapters/pypi-listing.ts src/__tests__/submit-pypi-listing.test.ts
git commit -m "feat(submit): PyPI assisted-manual adapter (pyproject diff → release)"
```

---

## Task 7: Register the new adapters

**Files:** Modify `src/submit/registry.ts`; test `src/__tests__/submit-registry.test.ts` (extend).

- [ ] **Step 1: Add failing assertions to `src/__tests__/submit-registry.test.ts`**

Add these cases inside the existing `describe('submit adapter registry', ...)` block:

```ts
  it('routes the github repo surface to the api adapter', () => {
    const a = adapterFor({ surfaceId: 'github-repo-about-topics-readme-releases', name: 'GitHub repo' } as any);
    expect(a?.plan({ links: {} } as any, {} as any).mechanism).toBe('api');
  });

  it('routes npm and pypi to assisted-manual adapters', () => {
    expect(adapterFor({ surfaceId: 'npm', name: 'npm' } as any)?.plan({ links: {} } as any, {} as any).mechanism).toBe('assisted_manual');
    expect(adapterFor({ surfaceId: 'pypi', name: 'PyPI' } as any)?.plan({ links: {} } as any, {} as any).mechanism).toBe('assisted_manual');
  });
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-registry.test.ts`. Expected: FAIL (new adapters not registered; `adapterFor` returns undefined for github/npm/pypi).

- [ ] **Step 3: Update `src/submit/registry.ts`**

Add imports and extend the array:

```ts
import type { Surface } from '../surfaces/resolve.js';
import type { SubmitAdapter } from './types.js';
import { a2aCardAdapter } from './adapters/a2a-card.js';
import { x402Adapter } from './adapters/x402.js';
import { padXmlAdapter } from './adapters/pad-xml.js';
import { githubRepoAdapter } from './adapters/github-repo.js';
import { npmListingAdapter } from './adapters/npm-listing.js';
import { pypiListingAdapter } from './adapters/pypi-listing.js';

// No catch-all: a surface with no adapter is simply not actionable yet.
export const SUBMIT_ADAPTERS: SubmitAdapter[] = [
  a2aCardAdapter, x402Adapter, padXmlAdapter,
  githubRepoAdapter, npmListingAdapter, pypiListingAdapter,
];

export function adapterFor(surface: Surface): SubmitAdapter | undefined {
  return SUBMIT_ADAPTERS.find(a => a.matches(surface));
}
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-registry.test.ts`. Expected: PASS (4 tests).
- [ ] **Step 5: Commit**

```bash
git add src/submit/registry.ts src/__tests__/submit-registry.test.ts
git commit -m "feat(submit): register github/npm/pypi Class B adapters"
```

---

## Task 8: Planner — update-in-place exemption from skip-if-listed

**Files:** Modify `src/submit/plan.ts`; test `src/__tests__/submit-plan.test.ts` (extend).

Owned-channel `api` surfaces (GitHub) are updates, so they must be proposed even
when presence says `listed`. The payload-hash idempotency check still prevents
redundant re-proposals.

- [ ] **Step 1: Add a failing test to `src/__tests__/submit-plan.test.ts`**

Add a new `seedSurface` call for github in the existing `beforeEach` (after the two existing `seedSurface(...)` lines):

```ts
    await seedSurface('github-repo-about-topics-readme-releases', 'autonomous');
```

Then add this test inside the `describe('planSubmissions', ...)` block. Note the
record body in `beforeEach` lacks a `repository` link, so add one by updating the
`record` const at the top of the file: change its `links` to
`links: { agent_endpoint: 'https://beacon.example.com/a2a', homepage: 'https://beacon.example.com', repository: 'https://github.com/exampleco/beacon' }`.

```ts
  it('proposes an owned-channel api surface even when presence says listed', async () => {
    await db.insert(auditRuns).values({
      auditId: ulid(), recordId, coverageScore: 0, report: {}, startedAt: 'a', finishedAt: 'b',
      presence: [{ surfaceId: 'github-repo-about-topics-readme-releases', state: 'listed', confidence: 'high' }],
    });
    const n = await planSubmissions(recordId);
    expect(n).toBe(1);
    const rows = await db.select().from(approvalQueue);
    expect(rows[0].mechanism).toBe('api');
  });
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-plan.test.ts`. Expected: the new test FAILS (current planner skips the `listed`+high github surface, so `n` is 0). The four pre-existing planner tests still pass.

- [ ] **Step 3: Update `src/submit/plan.ts`**

Add an update-in-place mechanism set near the top constants:

```ts
// Owned-channel updates (e.g. GitHub repo metadata) are NOT creates — propose them
// even when presence says 'listed'; payload-hash idempotency stops redundant work.
const UPDATE_MECHANISMS = new Set(['api']);
```

Then reorder the per-surface loop so the adapter/proposal is built BEFORE the
skip-if-listed check, and exempt update mechanisms. Replace the loop body from
`const pres = presenceBy.get(...)` through the `enqueue` call with:

```ts
    const pres = presenceBy.get(surface.surfaceId);
    if (!pres) continue; // only act on surfaces the audit evaluated

    const adapter = adapterFor(surface);
    if (!adapter) continue;

    const proposal = adapter.plan(record, surface);

    // Skip when already listed — but ONLY for create-type mechanisms.
    if (!UPDATE_MECHANISMS.has(proposal.mechanism)
        && pres.state === 'listed' && pres.confidence === 'high') continue;

    const payloadHash = hashPayload(proposal.payload);

    const existing = await db.select().from(approvalQueue).where(and(
      eq(approvalQueue.recordId, recordId),
      eq(approvalQueue.surfaceId, surface.surfaceId),
      inArray(approvalQueue.status, OPEN_STATUSES),
    ));
    if (existing.some(r => r.payloadHash === payloadHash)) continue;

    await enqueue({
      recordId, surfaceId: surface.surfaceId, managePolicy: surface.managePolicy,
      mechanism: proposal.mechanism, payload: proposal.payload, payloadHash, preview: proposal.preview,
    });
    enqueued++;
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-plan.test.ts`. Expected: PASS (5 tests).
- [ ] **Step 5: Commit**

```bash
git add src/submit/plan.ts src/__tests__/submit-plan.test.ts
git commit -m "fix(submit): propose owned-channel api updates even when presence is listed"
```

---

## Task 9: `submit:connect` CLI + script + docs

**Files:** Create `src/submit-connect.ts`; modify `package.json`, `README.md`.

- [ ] **Step 1: Implement `src/submit-connect.ts`** (match `src/audit.ts` CLI conventions)

```ts
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
```

- [ ] **Step 2: Add the script to `package.json`** — in `"scripts"`, after `"submit:run"`:

```json
    "submit:connect": "tsx src/submit-connect.ts",
```

- [ ] **Step 3: Typecheck + full suite** — Run `npx tsc --noEmit && npx vitest run`. Expected: tsc clean; all tests pass (Phase 1's 77 + the new Phase 2 tests).

- [ ] **Step 4: Update `README.md`** — in the "## Submitting (experimental)" section, replace the intro paragraph and command list so it reads:

```markdown
The audit tells you where you're absent; the `submit:*` commands help you act on it.
Manifests (A2A card, x402, PAD XML) generate a file you host; owned channels you
control (GitHub repo metadata) are updated via API after you connect a token;
npm/PyPI changes are prepared for you to publish. Everything is gated behind human
approval — nothing is auto-posted.

    npm run submit:connect -- <slug>   # verify which platform tokens are set/valid
    npm run submit:plan -- <slug>      # propose submissions from the latest audit
    npm run submit:review -- <slug>    # inspect previews; --approve-all or --approve <id>
    npm run submit:run -- <slug>       # execute approved actions (generate files / API writes)

`submit:connect` reads tokens from `.env` (e.g. `GITHUB_TOKEN`), so once set they
persist across runs — re-running the loop after a project change re-submits only
what changed. Third-party registry submissions land in a later phase.
```

- [ ] **Step 5: Commit**

```bash
git add src/submit-connect.ts package.json README.md
git commit -m "feat(submit): submit:connect CLI + Class B docs"
```

---

## Task 10: End-to-end smoke test (manual)

**Files:** none (verification only).

- [ ] **Step 1: Re-seed (prior test runs wipe the surfaces table) and run the flow**

```bash
npm run seed
npm run intake -- data/example.json
npm run audit -- beacon
npm run submit:connect -- beacon     # expect: github row shows 'missing' (no token) — that's fine
npm run submit:plan -- beacon
npm run submit:review -- beacon      # expect manifest + github + npm/pypi previews depending on record links
npm run submit:run -- beacon
```

Expected: `submit:connect` prints a connection table; `submit:plan` reports >= 1; the GitHub api proposal executes to `failed` only if no token (acceptable for the smoke test — the point is it routes correctly); manifest proposals still generate files under `out/beacon/`. No crashes; exit codes 0.

- [ ] **Step 2: Confirm idempotency** — re-run `npm run submit:plan -- beacon`; expect "Planned 0".

There is no commit for this task (verification only).

---

## Done criteria for Phase 2

- `npx vitest run` green (Phase 1 tests + new Phase 2 tests).
- `npx tsc --noEmit` clean.
- `submit:connect -- beacon` reports a connection table and writes `connection_status` rows.
- The GitHub api adapter routes and executes (submitted with a valid token; failed without).
- npm/PyPI resolve to `needs_human` with prepared diffs.
- The planner proposes the GitHub owned-channel surface even when its presence is `listed`.

Phase 2b (Docker Hub + Hugging Face api adapters) and Phase 3 (Class C third-party
+ the confidence gate) build on this unchanged.
