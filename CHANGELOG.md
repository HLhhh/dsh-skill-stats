# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Dependency-free smoke tests (`npm test`) and a GitHub Actions workflow.
