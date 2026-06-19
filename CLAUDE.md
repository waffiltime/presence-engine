# presence-engine

A one-shot **visibility audit** for a software project: checks whether the project
is listed (correctly) on the surfaces that matter for its kind — registries,
directories, package indexes, communities, search — then produces a coverage
score and an actionable report.

## Architecture

One Node process, one linear pipeline:

`intake → resolve surfaces → presence checks → coverage score → report`

Everything derives from one Ajv-validated **canonical record** per project
(`canonical-record.schema.json` is authoritative). Surfaces come from
`surface-registry.csv`, seeded into SQLite.

## Stack — decided, do not relitigate

- TypeScript on Node, ESM (`"type": "module"`).
- Drizzle + better-sqlite3 (WAL). Keep DB types portable for a future Postgres
  swap: ISO-text timestamps, JSON-as-text, integer booleans.
- Ajv validates every record before it is written.
- `@anthropic-ai/sdk` is **pinned** — never float it.
- Workflows, not autonomous agents: every step is enumerable code with LLM
  calls inside specific nodes.

## Conventions

- IDs: ULID. Timestamps: ISO-8601 text. JSON columns: `text({ mode: 'json' })`.
- Append-only tables (`provenance_log`, `record_versions`): never update/delete.
- Every meaningful state change calls `logEvent()` → `provenance_log`.
- CLI entrypoints: try/catch/finally with `closeDb()`; set `process.exitCode`,
  never call `process.exit()` (it races libuv teardown on Windows).
- TDD: failing test first, minimal implementation, `npx vitest run` green
  before every commit.

## Commands

| Command | Does |
|---|---|
| `npm run keys:check` | verify API keys in `.env` actually work |
| `npm run generate` / `npm run migrate` | Drizzle migrations |
| `npm run seed` | load `surface-registry.csv` into the surfaces table |
| `npm run intake -- data/example.json` | validate + upsert a canonical record |
| `npm run audit -- <slug>` | run the visibility audit |
| `npm test` | vitest |
