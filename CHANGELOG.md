# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/beccariamatias/agent-observer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/beccariamatias/agent-observer/releases/tag/v0.1.0
