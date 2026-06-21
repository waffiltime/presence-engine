<div align="center">

# presence-engine

**A one-shot visibility audit for your software project.**

Describe your project once in a small JSON record. `presence-engine` checks the
surfaces that actually matter for your project's kind — agent registries, package
indexes, GitHub, directories, communities, and open-web search — then prints a
coverage score and a ranked list of concrete fixes.

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)

</div>

```
=== Visibility Audit: beacon ===
Score: 68/100

Beacon: coverage 68/100. Listed on 11, absent from 6, not checked 4 of 21 surfaces.

1. [high]   Get listed on smithery.ai (smithery-ai)
2. [high]   Get listed on mcp.so (mcp-so)
3. [medium] Publish /.well-known/agent.json (a2a-agent-card-well-known-agent-json)
4. [medium] Add topics + About to the GitHub repo (github-repo-about-topics-readme-releases)
5. [low]    Submit to awesome-mcp-servers (awesome-mcp-servers-github)
```

---

## Why

Shipping a project isn't the same as being findable. The people — and
increasingly, the *agents* — looking for what you built discover it through
registries, package indexes, and directories, not your homepage. Being absent
(or listed with stale, wrong metadata) on the right surfaces is a silent tax on
adoption. `presence-engine` makes that gap measurable and gives you a punch list.

## Features

- **One record, many surfaces.** Everything derives from a single
  Ajv-validated [canonical record](canonical-record.schema.json). Describe your
  project once.
- **Kind-aware.** A `library` is audited against package indexes; an `ai_agent`
  against MCP/agent registries. Surfaces are matched to your project's `kind`.
- **Honest confidence.** The GitHub adapter checks your repo directly (high
  confidence). Everything else is inferred from scoped web search and is clearly
  marked low confidence — the tool never pretends to know more than it does.
- **Weighted coverage score.** High-priority surfaces count for more than
  nice-to-haves; surfaces it couldn't check are excluded rather than guessed.
- **Works offline-ish.** No API keys? The audit still runs and emits a
  deterministic, templated report instead of an LLM-written one.
- **Fully auditable.** Every run is persisted and every state change is written
  to an append-only provenance log.

## How it works

One linear pipeline, one Node process — no autonomous agents, every step is
enumerable code:

```
intake → resolve surfaces → presence checks → coverage score → report
```

| Stage | What happens |
|---|---|
| **intake** | Your JSON record is validated against the schema and upserted into SQLite. Re-intake snapshots the old version. |
| **resolve surfaces** | The [surface registry](surface-registry.csv) (41 surfaces) is filtered to those relevant to your project's `kind`. |
| **presence checks** | Each surface is probed. High-confidence adapters hit authoritative APIs directly — **GitHub** (repo), **npm** and **PyPI** (package registries); the **web-search** adapter (Brave) covers everything else at low confidence. Surfaces the registry marks as un-monitorable resolve to `unknown` instead of a guess. |
| **coverage score** | A priority-weighted average over every surface that could be checked. |
| **report** | Claude (Sonnet) writes a tight summary + ranked action points. Without a key, a deterministic template is used. |

## Quick start

> Requires **Node 20+**.

```bash
git clone https://github.com/<you>/presence-engine.git
cd presence-engine
npm install

cp .env.example .env       # add your keys (see Configuration)
npm run keys:check         # verifies each key actually works

npm run generate && npm run migrate   # set up the SQLite schema
npm run seed                          # load the 41-surface registry
```

## Configuration

Keys live in `.env`. The tool degrades gracefully when they're missing — it just
tells you what it couldn't check.

| Key | Needed for | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | LLM-written report synthesis | [console.anthropic.com](https://console.anthropic.com) |
| `BRAVE_SEARCH_API_KEY` | web-search presence checks | [brave.com/search/api](https://brave.com/search/api) (free tier) |
| `GITHUB_TOKEN` | *optional* — raises the GitHub rate limit from 60 to 5000 req/hr | [github.com/settings/tokens](https://github.com/settings/tokens) |

Without `BRAVE_SEARCH_API_KEY`, registry/directory surfaces resolve to `unknown`
and are excluded from the score. Without `ANTHROPIC_API_KEY`, you get the
templated report. The audit prints a note telling you exactly what was skipped.

## Usage

1. **Describe your project.** Copy the example and edit it:

   ```bash
   cp data/example.json data/my-project.json
   ```

   The `disambiguation` block is what separates real mentions of your project
   from unrelated things that share its name — fill it in carefully. See
   [`canonical-record.schema.json`](canonical-record.schema.json) for every field.

2. **Intake and audit:**

   ```bash
   npm run intake -- data/my-project.json
   npm run audit -- my-project-slug
   ```

Re-running `intake` on an edited record updates it in place and snapshots the
previous version — it's never a silent no-op.

## Understanding the score

The coverage score is a **priority-weighted average** over every surface that
could actually be checked:

- Each surface carries a build priority — **P1** (weight 3), **P2** (2), or
  **P3** (1).
- Each presence result is scored: `listed` = 1.0, `wrong` (listed but with bad
  metadata) = 0.5, `absent` = 0.0.
- `unknown` surfaces (no data source, or a failed/unauthenticated check) are
  **excluded** from both sides of the average — never counted as a zero.

```
score = round( Σ(weight × state_score) / Σ(weight) × 100 )
```

So a high score means you're well-listed on the surfaces that matter *most* for
your kind of project, not merely on the most surfaces.

## Submitting (experimental)

The audit tells you where you're absent; the `submit:*` commands help you act on it.
Phase 1 covers self-hosted manifests (A2A agent card, x402, PAD XML) — generated
from your record, gated behind human approval, never auto-posted:

    npm run submit:plan -- <slug>      # propose submissions from the latest audit
    npm run submit:review -- <slug>    # inspect previews; --approve-all or --approve <id>
    npm run submit:run -- <slug>       # generate approved artifacts into out/<slug>/

Manifest surfaces produce a file you deploy to your own domain; the next audit
confirms it went live. Credentialed (npm/GitHub/etc.) and third-party submissions
land in later phases.

## The surface registry

`surface-registry.csv` is the data that drives everything — 41 surfaces, each
tagged with the project kinds it applies to (`agent`, `api`, `dev`, `lib`,
`web`, `model`, `desktop`, `mobile`, or `all`) and a build priority. It's a plain
CSV: add a row to track a new surface, re-run `npm run seed`, and it's in the
next audit. PRs that add high-quality surfaces are welcome.

Project kinds understood by the canonical record: `saas`, `web_app`, `dev_tool`,
`library`, `api`, `ai_agent`, `model`, `desktop_app`, `mobile_app`.

## Tech stack

TypeScript on Node (ESM) · Drizzle ORM + better-sqlite3 (WAL) · Ajv for
validation · the official `@anthropic-ai/sdk` (pinned) · Vitest. DB types are
kept portable (ISO-text timestamps, JSON-as-text, integer booleans) for a future
Postgres swap.

## Scripts

| Command | Does |
|---|---|
| `npm run keys:check` | verify the API keys in `.env` actually work |
| `npm run generate` / `npm run migrate` | Drizzle migrations |
| `npm run seed` | load `surface-registry.csv` into the surfaces table |
| `npm run intake -- <file>` | validate + upsert a canonical record |
| `npm run audit -- <slug>` | run the visibility audit |
| `npm test` | run the Vitest suite |

## Roadmap

- **More package adapters.** High-confidence checks against crates.io, Docker
  Hub, and Hugging Face (npm and PyPI already ship; these need new `links` fields
  on the canonical record).
- **Mentions & opportunities.** Scan HN/Reddit/GitHub for real (disambiguated)
  mentions, flag factual errors, and surface unanswered threads with drafted
  replies — never auto-posted.
- **Owned-surface fixes.** Generate agent cards / GitHub metadata straight from
  the record, behind an interactive approval gate.

## Contributing

Issues and PRs welcome. The project is strict about a few things:

- **TDD.** Failing test first, minimal implementation, `npm test` green before
  every commit.
- **Append-only tables** (`provenance_log`, `record_versions`) are never updated
  or deleted.
- Keep DB types portable; don't float the pinned `@anthropic-ai/sdk`.

See [CLAUDE.md](CLAUDE.md) for the full conventions.

## License

[MIT](LICENSE) © Phillip Jun
