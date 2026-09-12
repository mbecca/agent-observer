# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-09-12

### Fixed

- `current` no longer reports a different session's subagents as though they
  were this session's. When the environment names a session that recorded no
  subagents, that session is now reported empty, because "this session used
  none" is the true answer. A fallback to the most recent session now happens
  only when the named session is unknown, and says so on stdout.
- A session requested by name is no longer hidden by the rule that omits empty
  sessions from listings.
- Project paths recorded on another operating system are shortened correctly.
  `path.basename` only recognises the separator of the platform it runs on, so
  on Linux and macOS a Windows path was left whole in the project column. This
  affected the Claude Code and Codex adapters.

## [0.1.0] - 2026-09-11

First release.

### Added

- Agent-agnostic core: a common event model, role inference, filtering and
  renderers that every adapter shares.
- Claude Code adapter reading `~/.claude/projects/**/subagents/*.meta.json` for
  the model, type, task, spawn depth, duration and turn count of every
  dispatched subagent.
- Codex adapter reporting the session model it can observe, and stating
  explicitly that per-subagent attribution is not available from its rollouts.
- Generic adapter that ingests the common event format from any agent, so a tool
  outside this repo can be observed without changing the core.
- Commands: `current`, `session`, `sessions`, `tree`, `models`, `timeline`,
  `watch`, `export`, `adapters` and `doctor`.
- Output formats: table, tree, timeline, summary, JSON, NDJSON, CSV and
  Markdown.
- Claude Code plugin with an `agent-observer` skill and a `/subagent-report`
  command, plus a marketplace manifest so the repository installs directly.
- Cross-platform support on Windows, Linux and macOS with no runtime
  dependencies.

[Unreleased]: https://github.com/mbecca/agent-observer/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/mbecca/agent-observer/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mbecca/agent-observer/releases/tag/v0.1.0
