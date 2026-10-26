# Agent notes

## Collaboration rule (required)

This repository is maintained by one human (`HLhhh`) plus an AI agent.

**Before modifying any tracked file, ask the maintainer which path to use:**

- **Pull request** — branch + PR through the template in `.github/`. Preferred for
  behaviour changes, version bumps, UI changes, and anything that touches counting.
- **Direct push to `main`** — only when the maintainer explicitly asks for it
  (a docs-only edit or an urgent one-liner, for example).

Never infer the path from the size of the change, and never switch paths mid-task
without asking. `main` has no branch protection by the maintainer's decision;
this rule is what replaces it.

A **direct push to `main`** must record the maintainer's authorization in the
commit message as a `Maintainer-authorized:` trailer naming what was authorized
and when — git history is the only audit trail while protection is off.

## Conventions

- `npm test` must pass before a change lands. It is dependency-free.
- A behaviour change bumps `package.json` and adds a `CHANGELOG.md` entry
  (Keep a Changelog format, SemVer).
- A change to the panel's appearance requires regenerated screenshots in `docs/`.
- The panel counts **live host events only** (`tools/result`, `session/event`).
  Do not reintroduce session-log parsing.
- Never commit credentials, local absolute paths, or generated counter files.
- Keep the inventory sources honest: the skills service, disk skill roots,
  installed plugin packages, and preset scopes — no log-derived snapshots.
