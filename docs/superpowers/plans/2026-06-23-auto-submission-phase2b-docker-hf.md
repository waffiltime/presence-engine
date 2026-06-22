# Auto-Submission — Phase 2b: Docker Hub (api) + Hugging Face (assisted-manual) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover the two remaining owned-channel package surfaces. **Docker Hub** gets a real `api` adapter (log in with a PAT → JWT, then PATCH the repository's `full_description`). **Hugging Face** gets an assisted-manual adapter that prepares the model-card README (YAML metadata + body) for the user to commit — the raw Hub commit API is too fragile to ship. Adds `docker_image`/`hf_model` to the canonical record so the adapters know which repo to target, and Docker Hub to `submit:connect`.

**Architecture:** Two new adapters plug into the existing `SUBMIT_ADAPTERS` registry. The Docker adapter performs its authenticated write only in `execute()`. A new `CredentialSpec` lets `submit:connect` verify Docker credentials. No planner or queue changes — the existing backbone handles both. The confidence gate and `github_pr` are intentionally NOT built (research showed smithery has no submit API and is already assisted-manual; awesome-mcp stays assisted-manual; with no create-type third-party auto-submit, the confidence gate would be unused).

**Tech Stack:** Same as prior phases. Spec: `docs/superpowers/specs/2026-06-20-auto-submission-design.md`.

**Researched facts this plan relies on:**
- Docker Hub: `POST https://hub.docker.com/v2/users/login` with JSON `{username, password}` (password = PAT) → `200 { token }`. Then `PATCH https://hub.docker.com/v2/repositories/{namespace}/{repository}/` with JSON `{full_description}` and header `Authorization: JWT <token>` → `200`.
- Hugging Face: the model card is the repo's `README.md` (YAML front-matter + markdown). Editing it programmatically uses the Hub commit API (NDJSON multipart) — deliberately handled as assisted-manual here.

---

## File structure

- `canonical-record.schema.json` — MODIFY: add optional `docker_image`, `hf_model` to `links`.
- `src/submit/adapters/docker-hub.ts` — NEW: Docker Hub `api` adapter.
- `src/submit/adapters/hugging-face.ts` — NEW: Hugging Face assisted-manual adapter.
- `src/submit/credentials.ts` — MODIFY: add the Docker Hub `CredentialSpec`.
- `src/submit/registry.ts` — MODIFY: register both adapters.
- `.env.example` — MODIFY: document `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`.
- Tests: new adapter tests + extensions to `submit-registry.test.ts` and `submit-connect.test.ts`.

---

## Task 1: Schema — `docker_image` + `hf_model`

**Files:** Modify `canonical-record.schema.json`; test `src/__tests__/validate.test.ts` (extend) — or add a focused assertion if that file mocks differently; read it first.

- [ ] **Step 1: Add a failing test** — append to `src/__tests__/validate.test.ts` a case that a record carrying the new link fields validates. First read the file to match its existing `validateRecord` import and the minimal valid record shape it already uses; then add:

```ts
  it('accepts optional docker_image and hf_model in links', () => {
    const rec = {
      schema_version: '1.0',
      record_id: 'rec_x',
      subject: { kind: 'library', canonical_name: 'X', slug: 'x', lifecycle_status: 'live' },
      links: { docker_image: 'exampleco/beacon', hf_model: 'exampleco/beacon' },
    };
    expect(validateRecord(rec).valid).toBe(true);
  });
```

(If the local `validateRecord` returns a different shape, match it — the point is the record validates.)

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/validate.test.ts`. Expected: FAIL — `additionalProperties` rejects `docker_image`/`hf_model`.

- [ ] **Step 3: Update `canonical-record.schema.json`** — in `properties.links.properties`, after `pypi_package`, add:

```json
        "docker_image": { "type": "string", "description": "Docker Hub image as 'namespace/repository', e.g. 'exampleco/beacon'." },
        "hf_model": { "type": "string", "description": "Hugging Face model id as 'org/model'." }
```

(Add a comma after the `pypi_package` line so the JSON stays valid.)

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/validate.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add canonical-record.schema.json src/__tests__/validate.test.ts
git commit -m "feat(schema): add optional links.docker_image and links.hf_model"
```

---

## Task 2: Docker Hub `api` adapter

**Files:** Create `src/submit/adapters/docker-hub.ts`; test `src/__tests__/submit-docker-hub.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { dockerHubAdapter } from '../submit/adapters/docker-hub.js';

const surface = { surfaceId: 'docker-hub', name: 'Docker Hub' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon' },
  positioning: { one_liner: 'An example image.', long_description: 'Longer description of Beacon.' },
  links: { docker_image: 'exampleco/beacon' },
};

describe('dockerHubAdapter', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('matches only the docker-hub surface', () => {
    expect(dockerHubAdapter.matches(surface)).toBe(true);
    expect(dockerHubAdapter.matches({ surfaceId: 'npm', name: 'npm' } as any)).toBe(false);
  });

  it('plan() parses namespace/repo and builds an api payload', () => {
    const p = dockerHubAdapter.plan(record, surface);
    expect(p.mechanism).toBe('api');
    expect(p.payload.namespace).toBe('exampleco');
    expect(p.payload.repository).toBe('beacon');
    expect(String(p.payload.full_description)).toContain('Beacon');
  });

  it('execute() without credentials returns failed', async () => {
    vi.stubEnv('DOCKERHUB_USERNAME', '');
    vi.stubEnv('DOCKERHUB_TOKEN', '');
    const p = dockerHubAdapter.plan(record, surface);
    const r = await dockerHubAdapter.execute(p, surface);
    expect(r.outcome).toBe('failed');
    expect(r.notes).toMatch(/DOCKERHUB/);
  });

  it('execute() logs in then PATCHes the description and returns submitted', async () => {
    vi.stubEnv('DOCKERHUB_USERNAME', 'exampleco');
    vi.stubEnv('DOCKERHUB_TOKEN', 'pat');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 200, json: () => Promise.resolve({ token: 'jwt123' }) }) // login
      .mockResolvedValueOnce({ status: 200, json: () => Promise.resolve({}) });                  // PATCH
    vi.stubGlobal('fetch', fetchMock);
    const p = dockerHubAdapter.plan(record, surface);
    const r = await dockerHubAdapter.execute(p, surface);
    expect(r.outcome).toBe('submitted');
    expect(r.evidenceUrl).toBe('https://hub.docker.com/r/exampleco/beacon');
    // second call is the PATCH with the JWT
    const patchCall = fetchMock.mock.calls[1];
    expect(patchCall[0]).toContain('/v2/repositories/exampleco/beacon/');
    expect(patchCall[1].headers.Authorization).toBe('JWT jwt123');
  });

  it('execute() returns failed when login fails', async () => {
    vi.stubEnv('DOCKERHUB_USERNAME', 'exampleco');
    vi.stubEnv('DOCKERHUB_TOKEN', 'bad');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ status: 401, json: () => Promise.resolve({}) }));
    const p = dockerHubAdapter.plan(record, surface);
    const r = await dockerHubAdapter.execute(p, surface);
    expect(r.outcome).toBe('failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-docker-hub.test.ts`. Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/submit/adapters/docker-hub.ts`**

```ts
import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function parseImage(record: any): { namespace: string; repository: string } | undefined {
  const img: string | undefined = record?.links?.docker_image;
  if (!img) return undefined;
  const m = img.match(/^([^/]+)\/([^/:]+)/);
  if (!m) return undefined;
  return { namespace: m[1], repository: m[2] };
}

export const dockerHubAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'docker-hub',

  plan(record, _surface): SubmitProposal {
    const parsed = parseImage(record);
    const full = record?.positioning?.long_description ?? record?.positioning?.one_liner ?? '';
    const payload = {
      namespace: parsed?.namespace ?? '',
      repository: parsed?.repository ?? '',
      full_description: full,
    };
    const preview = parsed
      ? `Update Docker Hub ${payload.namespace}/${payload.repository} full description:\n${full}`
      : 'No links.docker_image declared — cannot update.';
    return { mechanism: 'api', payload, preview };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const username = process.env.DOCKERHUB_USERNAME;
    const token = process.env.DOCKERHUB_TOKEN;
    if (!username || !token) return { outcome: 'failed', notes: 'no DOCKERHUB_USERNAME/DOCKERHUB_TOKEN set — run submit:connect' };
    const { namespace, repository, full_description } = proposal.payload as {
      namespace: string; repository: string; full_description: string;
    };
    if (!namespace || !repository) return { outcome: 'failed', notes: 'no links.docker_image declared' };

    const login = await fetch('https://hub.docker.com/v2/users/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: token }),
    });
    if (login.status !== 200) return { outcome: 'failed', notes: `Docker Hub login returned ${login.status}` };
    const { token: jwt } = (await login.json()) as { token?: string };
    if (!jwt) return { outcome: 'failed', notes: 'Docker Hub login returned no token' };

    const patch = await fetch(`https://hub.docker.com/v2/repositories/${namespace}/${repository}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `JWT ${jwt}` },
      body: JSON.stringify({ full_description }),
    });
    if (patch.status !== 200) return { outcome: 'failed', notes: `Docker Hub PATCH returned ${patch.status}` };
    return { outcome: 'submitted', evidenceUrl: `https://hub.docker.com/r/${namespace}/${repository}`, notes: 'updated Docker Hub description' };
  },
};
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-docker-hub.test.ts`. Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/adapters/docker-hub.ts src/__tests__/submit-docker-hub.test.ts
git commit -m "feat(submit): Docker Hub api adapter (login + PATCH full_description)"
```

---

## Task 3: Hugging Face assisted-manual adapter

**Files:** Create `src/submit/adapters/hugging-face.ts`; test `src/__tests__/submit-hugging-face.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { huggingFaceAdapter } from '../submit/adapters/hugging-face.js';

const surface = { surfaceId: 'hugging-face', name: 'Hugging Face' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'embedding model' },
  positioning: { one_liner: 'An example model.', long_description: 'Longer description.' },
  links: { homepage: 'https://beacon.example.com', hf_model: 'exampleco/beacon' },
};

describe('huggingFaceAdapter', () => {
  it('matches only the hugging-face surface', () => {
    expect(huggingFaceAdapter.matches(surface)).toBe(true);
    expect(huggingFaceAdapter.matches({ surfaceId: 'docker-hub', name: 'Docker Hub' } as any)).toBe(false);
  });

  it('plan() builds an assisted_manual model-card with YAML front matter', () => {
    const p = huggingFaceAdapter.plan(record, surface);
    expect(p.mechanism).toBe('assisted_manual');
    const card = String((p.payload as any).card);
    expect(card.startsWith('---')).toBe(true);     // YAML front matter
    expect(card).toContain('# Beacon');
    expect(card).toContain('An example model.');
    expect(p.preview).toContain('README.md');
  });

  it('execute() does no network and returns needs_human', async () => {
    const p = huggingFaceAdapter.plan(record, surface);
    const r = await huggingFaceAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    expect(r.notes).toMatch(/commit|model repo/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-hugging-face.test.ts`. Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/submit/adapters/hugging-face.ts`**

```ts
import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function buildCard(record: any): string {
  const name = String(record?.subject?.canonical_name ?? record?.subject?.slug ?? 'Model');
  const oneLiner = String(record?.positioning?.one_liner ?? '');
  const long = String(record?.positioning?.long_description ?? oneLiner);
  const homepage = String(record?.links?.homepage ?? '');
  const license = String(record?.attributes?.license ?? 'other');
  const front = ['---', `license: ${license}`, 'tags:', '  - presence-engine', '---'].join('\n');
  return `${front}\n\n# ${name}\n\n${oneLiner}\n\n${long}\n\n${homepage}`.trim();
}

export const huggingFaceAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'hugging-face',

  plan(record, _surface): SubmitProposal {
    const card = buildCard(record);
    const model = record?.links?.hf_model ?? '(your model repo)';
    const preview = `Commit this as README.md in the Hugging Face model repo ${model}:\n\n${card}`;
    return { mechanism: 'assisted_manual', payload: { model, card }, preview };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const model = String((proposal.payload as any).model ?? 'your model repo');
    return { outcome: 'needs_human', notes: `Commit the prepared README.md to your Hugging Face model repo ${model} to update the model card.` };
  },
};
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-hugging-face.test.ts`. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/adapters/hugging-face.ts src/__tests__/submit-hugging-face.test.ts
git commit -m "feat(submit): Hugging Face assisted-manual adapter (model card README)"
```

---

## Task 4: Docker Hub credential spec + connect

**Files:** Modify `src/submit/credentials.ts`; extend `src/__tests__/submit-connect.test.ts`.

- [ ] **Step 1: Add a failing test** to `src/__tests__/submit-connect.test.ts`. In the existing `seedGithub` helper's pattern, add a second seeded surface and a test. First, add a helper near `seedGithub`:

```ts
async function seedDocker() {
  await db.insert(surfaces).values({
    surfaceId: 'docker-hub', name: 'Docker Hub', url: null, surfaceType: 'package_registry',
    relevantKinds: ['api', 'dev'], monitor: 'full', managePolicy: 'autonomous',
    manageMechanism: null, feedDriven: true, notes: null, buildPriority: 'P2',
  }).onConflictDoNothing();
}
```

Then add a test (it uses kind `dev_tool` so Docker Hub resolves; the `dev_tool`→`dev` mapping already exists):

```ts
  it('verifies Docker Hub via login when the token is set', async () => {
    await seedDocker();
    vi.stubEnv('DOCKERHUB_USERNAME', 'exampleco');
    vi.stubEnv('DOCKERHUB_TOKEN', 'pat');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    const summary = await connectSurfaces('rec1', 'dev_tool');
    expect(summary.find(s => s.surfaceId === 'docker-hub')?.state).toBe('connected');
  });
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-connect.test.ts`. Expected: FAIL — no `CredentialSpec` for `docker-hub`, so it is not in the summary (`state` is undefined).

- [ ] **Step 3: Update `src/submit/credentials.ts`** — add a second entry to `CREDENTIAL_SPECS`:

```ts
  {
    surfaceId: 'docker-hub',
    envVar: 'DOCKERHUB_TOKEN',
    mintUrl: 'https://app.docker.com/settings/personal-access-tokens',
    async verify(token: string): Promise<boolean> {
      const username = process.env.DOCKERHUB_USERNAME;
      if (!username) return false;
      const res = await fetch('https://hub.docker.com/v2/users/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: token }),
      });
      return res.status === 200;
    },
  },
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-connect.test.ts`. Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/submit/credentials.ts src/__tests__/submit-connect.test.ts
git commit -m "feat(submit): Docker Hub credential spec for submit:connect"
```

---

## Task 5: Register both adapters

**Files:** Modify `src/submit/registry.ts`; extend `src/__tests__/submit-registry.test.ts`.

- [ ] **Step 1: Add a failing assertion** inside the `describe('submit adapter registry', ...)` block:

```ts
  it('routes docker-hub to api and hugging-face to assisted-manual', () => {
    expect(adapterFor({ surfaceId: 'docker-hub', name: 'Docker Hub' } as any)?.plan({ links: {} } as any, {} as any).mechanism).toBe('api');
    expect(adapterFor({ surfaceId: 'hugging-face', name: 'Hugging Face' } as any)?.plan({ subject: {}, positioning: {}, links: {} } as any, {} as any).mechanism).toBe('assisted_manual');
  });
```

- [ ] **Step 2: Run test to verify it fails** — Run `npx vitest run src/__tests__/submit-registry.test.ts`. Expected: FAIL.

- [ ] **Step 3: Update `src/submit/registry.ts`** — add imports and append to the array:

```ts
import { dockerHubAdapter } from './adapters/docker-hub.js';
import { huggingFaceAdapter } from './adapters/hugging-face.js';
```

The array becomes:

```ts
export const SUBMIT_ADAPTERS: SubmitAdapter[] = [
  a2aCardAdapter, x402Adapter, padXmlAdapter,
  githubRepoAdapter, npmListingAdapter, pypiListingAdapter,
  dockerHubAdapter, huggingFaceAdapter,
  thirdPartyFormAdapter, draftAdapter,
];
```

- [ ] **Step 4: Run test to verify it passes** — Run `npx vitest run src/__tests__/submit-registry.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/submit/registry.ts src/__tests__/submit-registry.test.ts
git commit -m "feat(submit): register Docker Hub + Hugging Face adapters"
```

---

## Task 6: .env.example + README + final verification

**Files:** Modify `.env.example`, `README.md`.

- [ ] **Step 1: Document the Docker Hub creds in `.env.example`** — append:

```
# Optional — Docker Hub description updates (submit:connect / submit:run)
DOCKERHUB_USERNAME=
DOCKERHUB_TOKEN=
```

- [ ] **Step 2: Update `README.md`** — in the "## Submitting (experimental)" section, in the sentence that lists owned channels, change "GitHub repo metadata" to "GitHub repo metadata and Docker Hub descriptions" so it reads naturally.

- [ ] **Step 3: Full suite + typecheck** — Run `npx tsc --noEmit && npx vitest run`. Expected: tsc clean; all tests pass (Phase 4's 109 + the new Phase 2b tests).

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md
git commit -m "docs(submit): document Docker Hub creds; note Docker Hub in submit section"
```

---

## Done criteria for Phase 2b

- `npx vitest run` green (Phase 4 tests + new Phase 2b tests).
- `npx tsc --noEmit` clean.
- `docker-hub` routes to the `api` adapter; `hugging-face` to assisted-manual.
- `submit:connect` verifies Docker Hub credentials.
- Records may carry `links.docker_image` / `links.hf_model`.

This completes the auto-submission feature: every `autonomous`/`draft_only` surface in the
registry now routes to an adapter (api, assisted-manual, manifest, or draft). The only
intentionally-unbuilt items are `github_pr` auto-PR and the confidence gate — both
deliberately skipped because the surfaces they would serve are handled correctly as
assisted-manual, and smithery has no submit API.
