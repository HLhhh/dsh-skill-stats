# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-26

Internal restructuring. Counting inputs are unchanged (live host events only),
but the package's exported API changed and two semantics moved, so this is a
minor release rather than a patch. Every difference is listed below.

### Changed

- The host half is split into modules behind small interfaces:
  `lib/counter.js` (record / snapshot / flush), `lib/inventory.js`
  (list / invalidate), `lib/payload.js` (pure), `lib/window.js` (day and window
  maths), `lib/skills-md.js` (frontmatter and origin classification),
  `lib/diagnostics.js` (bounded record of swallowed failures). `index.js` is now
  an adapter that only wires host events and the route.
- Dependencies are accepted instead of created: the counter receives its
  directory and clock, the inventory receives its services, directories and
  clock. Tests run against temporary directories with a fake clock.
- Day maths has one owner; the payload layer no longer re-parses day keys that
  the counter wrote.
- The two inventory caches (service listing and plugin-package index) are now
  owned by one module and invalidated together on `skills/change`.
- Swallowed failures report to the new diagnostics sink and reach the API payload
  as a `diagnostics` array; missing files on first run are not failures.
- API tidy-up: `totals` no longer carries the scanner-era zero fields
  (`scannedSessions`, `liveSessions`, `fileSessions`, `skippedSessions`) that the
  panel never read after 0.2.0. Malformed stored day keys are ignored instead of
  being counted.
- The inventory reads `~/.agents/skills` from the real user home (new injected
  `userHome`, defaulting to `homedir()`), as 0.2.0 did. The modular extraction had
  briefly derived that path from `$DSH_HOME/..`, which pointed at a different
  directory whenever `DSH_HOME` was overridden; that regression never shipped.
- The panel's loading text says it is reading the counter file, not scanning
  session logs.

### Removed

- The package entry no longer re-exports `buildPayload`, `normalizeWindow` and
  `cutoffFor`; those were test conveniences. Import the module directly through
  the new subpath exports, e.g. `import { buildPayload } from 'dsh-skill-stats/lib/payload.js'`.
- `createCounter` exposes `record`, `snapshot` and `flush` only; `daily()` and
  `reset()` were removed until a feature consumes them.
- `test/smoke.mjs`, replaced by the `node:test` suite.

### Added

- 27 dependency-free tests run by `node --test test/`: counter (windows,
  persistence, injected clock, sessions, failures), inventory (four sources,
  user-home vs DSH home, cache/invalidate, failing preset service), payload
  (shares, uninstalled bucket, pinned totals shape), frontmatter and origin
  classification (CRLF/BOM, plugin labels), diagnostics (aggregation, bounds,
  real failures vs benign absences), route wiring, and the client bundle.

## [0.2.0] - 2026-10-26

### Changed

- **Counting is live-only.** The panel no longer reads session logs at all: it
  subscribes to the host's `tools/result` (an agent calling the `skill` tool) and
  `session/event` (a user invoking `/name`), and counts from the moment the
  plugin is first enabled. This removes the whole log-parsing path — and with it
  the multi-frame zstd class of bugs.
- Counters are debounced into `$DSH_HOME/storages/dsh-skill-stats/usage.json`, so
  they survive restarts; the panel route is a single small file read.
- The inventory is cached for a minute and invalidated by `skills/change`; it now
  also lists skills mounted inside each agent preset's scope.

### Removed

- Historical backfill from finished sessions (it required reading logs, which this
  release deliberately stops doing).
- The scanner-era fields `scanMs` and scanned-session counters.

## [0.1.1] - 2026-10-26

### Fixed

- **Finished sessions are read through the session persistence service.** A
  session log is a sequence of appended zstd frames, and one
  `zlib.zstdDecompressSync` call decodes only the first frame. On the Node 24
  runtime shipped with the Desktop app that reduced most finished sessions to
  their 313-byte header, so their skill usage silently disappeared from the
  panel. Measured on a 93-session corpus: 24 counted uses before, 29 after —
  matching an independent raw scan.
- Rescans now cache per session by the persistence revision instead of the file
  mtime, over both live and finished sessions. A warm scan drops from ~1.3 s to
  ~166 ms.

## [0.1.0] - 2026-10-25

### Added

- A left-sidebar **Skill usage** panel: installed / used / never used / total
  calls / sessions in the header, a sortable table underneath.
- Counting from the two explicit signals only — an agent calling the `skill`
  tool, and a user invoking a skill as `/name`. Everything else is ignored.
- Per-skill calls, distinct sessions, share of the current filter's calls, last
  used time, failure count, and a manual-only tag for `/name`-only skills.
- Time windows (all / today / 7 days / 30 days), source filter, search,
  never-used-only, and an optional "include uninstalled" switch.
- Rescan on open and every five seconds while open; finished session files are
  re-parsed only when their size or mtime changes.
- Fork-aware counting: inherited events (earlier than the session's creation
  time) and duplicate tool-call ids are dropped, so a continued session cannot
  count its parent's calls twice.
- Inventory merged from the skills service, disk skill roots, and per-session
  catalog snapshots, de-duplicated by name; `SKILL.md` frontmatter parsing is
  CRLF/BOM tolerant and respects `disable-model-invocation`.
- Origin resolution by file location, so a plugin-provided skill is labelled
  with its package name instead of the service's generic `bundled` source.
- Dependency-free smoke tests (`npm test`).
