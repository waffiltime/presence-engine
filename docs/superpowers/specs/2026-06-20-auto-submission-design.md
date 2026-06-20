# Auto-Submission Design

> **Status:** approved design / pre-implementation spec.
> **Scope:** the full auto-submission capability (Classes A+B+C+D) in one document,
> structured as a shared backbone plus separable per-class layers so it can be
> implemented in phases. Decided by the user: one comprehensive spec, not three.

## Goal

Today `presence-engine` is read-only: it audits a project's visibility and emits a
ranked punch list of where the project is absent. This feature lets a user **act on
that punch list** — connect their platform credentials once, then repeatedly push
their canonical record out to the surfaces that accept programmatic submission,
firing off updates whenever the project changes. Dangerous or human-judgment
surfaces are handled by preparing the work for a human, never by acting
autonomously.

The north-star is "describe once, stay listed everywhere." The repeatable loop:

```
edit canonical record → intake → audit → submit:plan → submit:review → submit:run
```

Credentials live in `.env` and persist, so only the record and the review step
change between runs.

## Architecture

A second linear pipeline, parallel to the existing audit pipeline, sharing the same
SQLite DB and append-only `provenance_log`. The audit pipeline stays **read-only and
untouched** — submission is a separate entrypoint, preserving the property that an
audit is always safe to run.

```
submit:connect ─ verifies .env credentials, records connection_status

submit:plan  →  approval_queue (pending)
                      │  submit:review  (human: approve / reject)
                      ▼
                approval_queue (approved)
                      │  submit:run  (final confirm → execute)
                      ▼
                execute via SubmitAdapter → outcome + provenance_log (actor=publisher)
```

### Commands

All four follow the existing CLI conventions in `audit.ts` / `intake-cli.ts`:
try/catch/finally with `closeDb()`, set `process.exitCode`, never call
`process.exit()`.

| Command | Does |
|---|---|
| `npm run submit:connect -- <slug>` | For each surface the project's `kind` can act on, read its `.env` token and do one cheap authenticated read. Record `connection_status` = `connected` / `missing` / `invalid` / `present_unverified`, with `last_verified_at`. For missing tokens, print the env var name and where to mint it. The token itself is never written to the DB. |
| `npm run submit:plan -- <slug>` | Read the latest audit's presence results. For each surface that is actionable (see Safety Gates), build a `SubmitProposal` and upsert it into `approval_queue` as `pending`. Idempotent (see Idempotency). `--force` re-proposes skipped surfaces. |
| `npm run submit:review -- <slug>` | List `pending` proposals with their previews; human marks each `approved` or `rejected`. Also re-lists `needs_human` / `draft` rows with their stored payload + link (the persistent to-do view). |
| `npm run submit:run -- <slug>` | Show a summary ("about to execute N external actions against M surfaces") and confirm. Then execute only `approved` proposals via the matching adapter, write the outcome, and log to `provenance_log`. |

## Data Model

Revive `approval_queue` (removed in the OSS slim-down) plus a small
`connection_status` table.

### `approval_queue`

| Column | Type | Purpose |
|---|---|---|
| `id` | text (ULID) | PK |
| `record_id` | text | which project |
| `surface_id` | text | which surface |
| `manage_policy` | text | snapshot of `autonomous`/`draft_only`/`never`/`none` at plan time |
| `mechanism` | text | `api` / `github_pr` / `manifest` / `assisted_manual` / `draft` |
| `payload` | text (JSON) | exact field values to send/generate |
| `payload_hash` | text | hash of `payload`, for change detection |
| `preview` | text | human-readable rendering shown at review |
| `status` | text | `pending` → `approved`/`rejected` → `submitted`/`pending_external`/`needs_human`/`failed` |
| `result` | text (JSON) | outcome detail (error message, PR url, file path) |
| `evidence_url` | text | external reference (PR url, hosted manifest url, package url) |
| `created_at` / `decided_at` / `executed_at` | text (ISO-8601) | lifecycle timestamps |

`status` is mutable (like other state tables); the audit trail is the append-only
`provenance_log`, written on every transition via `logEvent()`.

### `connection_status`

| Column | Type | Purpose |
|---|---|---|
| `surface_id` | text | PK with `record_id` |
| `record_id` | text | |
| `state` | text | `connected` / `missing` / `invalid` / `present_unverified` |
| `last_verified_at` | text (ISO-8601) | |

DB types stay portable per project convention (ISO-text timestamps, JSON-as-text).

## The `SubmitAdapter` Contract

Mirrors the existing `PresenceAdapter` so it reads like code already in the repo.

```ts
export type Mechanism = 'api' | 'github_pr' | 'manifest' | 'assisted_manual' | 'draft';

export type SubmitOutcome =
  | 'submitted'         // fully done: API write succeeded
  | 'pending_external'  // PR opened, awaiting a maintainer's merge
  | 'needs_human'       // payload prepared; a human performs the final step
  | 'failed';

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
  matches(surface: Surface): boolean;
  /** pure: build the proposal at plan time. No network, no credentials. */
  plan(record: CanonicalRecord, surface: Surface): SubmitProposal;
  /** the ONLY place writes and credentials happen. */
  execute(proposal: SubmitProposal, surface: Surface): Promise<SubmitResult>;
}
```

Routing works like `checkPresence`: an ordered `SUBMIT_ADAPTERS` array, first
`matches()` wins, **no catch-all** — a surface with no adapter is simply not
actionable and is skipped with a logged reason.

## Safety Gates (enforced centrally in the planner)

1. **`managePolicy` gate.** A surface is only proposed if its policy is `autonomous`
   or `draft_only`. `never` (Stack Overflow, Wikipedia, Discord) and `none` (open
   web, pkg.go.dev, YouTube, AI answer engines) are refused at plan time and never
   reach the queue.
2. **`plan()` is pure.** Preview generation has no side effects; only `execute()`
   touches the network or loads credentials (honoring the `publisher`-actor note in
   `constants.ts`).
3. **Confidence gate (anti-duplication).** A *create*-type submission to a
   third-party registry (`api` create or `github_pr`) is only auto-proposed when the
   audit's presence state for that surface is **high-confidence `absent`**. If
   presence is `unknown` or only low-confidence `absent` (e.g. inferred from web
   search), the proposal is **downgraded to `assisted_manual`** so a human verifies
   before a duplicate listing is created. Idempotent targets are exempt: manifests
   overwrite a file and owned-channel API updates (GitHub/Docker/HF) are safe to
   re-apply.
4. **Draft surfaces cannot fire.** No `draft`-mechanism adapter has a network-write
   `execute()`; it always returns `needs_human`. The registry's "instant ban"
   warnings are honored structurally, not by convention.

## Class → Mechanism Mapping

Each surface's mechanism is decided by which adapter `matches()` it.

### Class A — Manifest adapters (`mechanism: manifest`)
`A2AAgentCardAdapter` (`/.well-known/agent.json`), `X402ManifestAdapter`
(`/.well-known/x402`), `PadXmlAdapter` (desktop PAD XML).
- `plan()` generates the artifact deterministically from the record; the preview
  **is** the file contents.
- `execute()` writes the file to `out/<slug>/<path>` and returns **`needs_human`**
  with a "deploy to `https://<domain>/<path>`" instruction. It is *not* `submitted`,
  because the surface is not live until the user hosts the file; a later audit
  confirms it went live.
- No network, no credentials.

### Class B — Owned-channel adapters (heterogeneous)
- `api`: `GitHubRepoAdapter` (PATCH repo topics/description/homepage via the GitHub
  API, reusing `GITHUB_TOKEN`), `DockerHubAdapter` (repo description API),
  `HuggingFaceAdapter` (model card is a git repo — push via API). These edit
  listings the user already owns and are idempotent.
- `assisted_manual`: `NpmListingAdapter`, `PypiListingAdapter`. **npm and PyPI
  expose no API to edit a published package's metadata** — the listing is driven by
  `package.json` / upload-time metadata and only changes on a new release, which the
  tool must not perform. So `plan()` emits the exact metadata diff to apply locally
  ("set these `package.json` keywords / description, then publish") and `execute()`
  returns `needs_human`.

### Class C — Third-party adapters (split by real mechanism)
- `api` where a genuine self-serve submission API exists (e.g. `SmitheryAdapter`) —
  subject to the confidence gate.
- `github_pr`: `AwesomeListPrAdapter` for `awesome-mcp-servers`. This is **non-trivial
  and higher-maintenance**: fork the repo, insert the entry into the correct section
  in the list's markdown format, commit to the fork, open a PR. Returns
  `pending_external` (the merge is the maintainer's call); the open-PR url is stored
  as `evidence_url`. Leaves a persistent fork on the user's account.
- `assisted_manual` for form-only surfaces (mcp.so, SaaSHub, glama.ai, long-tail
  directories): `plan()` produces the filled field values + the submission deep
  link; `execute()` marks `needs_human`. No browser automation, no ToS/CAPTCHA risk.

### Class D — Draft adapters (`mechanism: draft`)
HN, Reddit, dev.to, Product Hunt, X. `plan()` uses the existing `drafter` LLM path
to write post copy; `execute()` returns `needs_human` with the draft + target URL.
Never auto-posts.

**Net effect:** every actionable surface produces something — an auto-submission, a
PR, or a prepared human hand-off — and the dangerous ones are structurally incapable
of firing themselves.

## Data Flow & Idempotency

The part that makes "fire off whenever there's an update" safe:

- `submit:plan` computes `payload_hash` for each surface and compares it to the last
  **executed** row for that `(record_id, surface_id)`:
  - **No prior submission** → propose a first submission (create).
  - **Prior submission, hash unchanged** → skip (nothing to do).
  - **Prior submission, hash changed** (new version, edited description) → propose an
    **update**; the preview shows an old→new diff.
- A surface already `pending` / `approved` (awaiting review/run) is skipped to avoid
  duplicate queue rows; `--force` overrides.
- A surface in `pending_external` (open PR) is **not** re-proposed; the planner
  records the open-PR url and polls its merge/close status. Re-running after a
  version bump updates the existing PR or skips, never opens a duplicate.
- A per-`(record, surface)` **`created`** marker (derived from the last
  `submitted`/`pending_external` row) distinguishes "first create" from "update," so
  indexing lag in the low-confidence presence check can never cause a duplicate
  create.

## Error Handling

- **No prior audit:** `submit:plan` requires a recent audit to read presence from.
  If none exists for the slug, it exits with a clear "run `npm run audit -- <slug>`
  first" message and a non-zero `exitCode` — it never plans against stale or absent
  data.
- **Plan stage** is pure; the only failure is a missing required record field for a
  given surface → that surface is skipped with a logged reason, never a crash.
- **Execute stage**: each adapter's `execute()` is wrapped (like `checkPresence`
  already wraps adapters). A thrown error becomes `outcome: failed` with the message
  in `result`; the queue row stays `approved` so a fixed credential + re-run retries
  it; the batch continues to the next item. One bad surface never aborts the run.
- **Auth failures** (401/403) report `failed` with a "re-check your token via
  `submit:connect`" hint.
- **Partial success is normal:** the queue's per-row status *is* the recovery state.
  Re-running `submit:run` only re-attempts `approved` / `failed` rows.

## Testing (TDD, per project convention)

- **Adapter unit tests** (one file each, `fetch` mocked) — same pattern as the
  presence adapters: `plan()` produces the right payload/preview; manifest adapters
  assert exact generated file contents; `execute()` maps API responses to the right
  `SubmitOutcome`.
- **Planner tests** — `managePolicy` gate refuses `never`/`none`; confidence gate
  downgrades low-confidence creates to `assisted_manual`; idempotency (no-change
  skip, changed→update, `--force`); routing to the first matching adapter.
- **Queue lifecycle tests** — `pending → approved → submitted`, and that every
  transition writes a `provenance_log` row.
- **`submit:connect` tests** — `connected` / `missing` / `invalid` /
  `present_unverified` classification from mocked auth reads.
- No live network in tests. A manual smoke check against one real surface (a
  throwaway GitHub repo) is documented but not automated.

## Known Limitations (stated up front)

1. **Coverage is gated on record completeness.** Surfaces require different fields
   (PAD XML has many; mcp.so wants a config schema) that the slim v1.0 record may not
   carry. Such surfaces are skipped at plan time with "missing field X." Expanding
   real coverage means growing the canonical-record schema per surface — tracked as
   follow-on work, not part of this spec.
2. **Some tokens are unverifiable.** Not every platform has a cheap auth-read
   endpoint, so `submit:connect` may report `present_unverified` rather than a clean
   `connected`/`invalid`.
3. **`github_pr` is maintenance-heavy.** It depends on a third-party list's markdown
   format and leaves a fork on the user's account; format drift will require updates.

## Out of Scope

- Headless-browser or HTTP-POST form automation (assisted-manual is used instead).
- OAuth "connect with…" flows (PATs in `.env` only).
- Publishing packages/releases (npm/PyPI submission is assisted-manual).
- Schema extensions to satisfy every surface's required fields (follow-on).
