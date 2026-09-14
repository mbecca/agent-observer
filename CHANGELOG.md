# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The HTML report no longer draws models grey. A full model id such as
  `claude-sonnet-4-5` now takes its family's colour, as the terminal already
  did. A model outside the three coloured families, such as `big-pickle` or
  `gpt-5.4`, borrows a colour whose family is absent from the report, so a
  report of only non-Claude models is in colour. When there are more of them
  than free colours, the rest are hatched, and `inherit` and `unknown` are
  drawn as dashed outlines. Only three colours pass the contrast checks side
  by side, so the same model can take a different colour in a different
  report.

## [0.5.0] - 2026-09-13

### Added

- An OpenCode plugin, shipped in the same npm package. Adding `"agent-observer"`
  to the `plugin` list in `opencode.json` installs the `agent-observer` skill
  and the `/subagent-report` command, both running the bundled tool with Node,
  with no global install. A `subagent-report` command already defined in
  `opencode.json` is left in place and takes precedence.
- The OpenCode adapter reads the session it runs in from `OPENCODE_SESSION_ID`,
  which the plugin sets, resolving a subagent's session to its top-level
  session.

### Fixed

- `current` and `tree` now prefer a session the environment names outright
  over one an adapter has to guess. And when the environment names more than
  one session — an agent nested inside another, or one whose data cannot be
  read here — they no longer pick one silently: they say so on stderr, naming
  the other session and how to look at it.

## [0.4.0] - 2026-09-13

### Added

- An `opencode` adapter, reading OpenCode's SQLite database directly: model,
  subagent type, task description, status, start and end time, turn count, and
  token usage and cost (in `extra`). A dispatch nested inside a dispatched
  session is read too, at the matching spawn depth, grouped under the same
  top-level session. It needs a Node version that ships `node:sqlite` without a
  flag, which Node 18 and 20 do not; there it reports itself unavailable rather
  than failing, and the rest of the tool is unaffected.

## [0.3.0] - 2026-09-13

### Added

- `--format html` writes a self-contained report: a timeline of which model ran
  each subagent and for how long, with a short paragraph naming what the routing
  did. One file, no JavaScript, no network references, and a print stylesheet
  that keeps the bars. The palette is three colours because no fourth passed the
  colourblind separation check against them; every row names its model in text
  regardless.
- The paragraph's sentences are arithmetic with declared thresholds and stay
  silent below them. The two that make claims about all subagent time also stay
  silent when any run's duration is unknown, and the report notes in small print
  when a sentence relies on inferred roles.

### Fixed

- `check-docs` no longer scans gitignored agent working directories, which made
  local verification fail on scratch files CI never sees.

### Not yet included

The report is a first cut of the approved dashboard. The KPI row, model and role
tallies, the multi-session index and a report date are listed as deferred in the
spec's `Delivered and deferred` section.

## [0.2.2] - 2026-09-12

Tooling only. Nothing about the plugin or the tool behaves differently, and
updating from 0.2.1 changes nothing you can observe. The release exists so the
published version and the repository tell the same story.

### Changed

- The CI plugin validation now runs with --strict, matching the check the
  community-marketplace review pipeline runs, so a submission-blocking problem
  shows up on a pull request rather than at submission time.
- Development moved to pnpm, pinned through `packageManager` so contributors and
  CI run the same version. `corepack enable` is the whole setup. CI installs
  with `--frozen-lockfile`, which is what the committed lockfile is for, since
  there are no dependencies to lock.
- This changes nothing about the published package or the plugin. The tool still
  has no dependencies and still needs nothing at run time beyond Node, and it
  still publishes to the npm registry, so it installs with whichever client you
  already use.

## [0.2.1] - 2026-09-12

### Fixed

- `current` swallowed a session id without a word, so `current 3a372c2d` looked
  like it had reported that session while actually reporting the one you are in.
  It now says the id was ignored and points at `session <id>`, on stderr so
  piped output is unaffected. `current` still never takes an id, because it is
  by definition the session you are in.

## [0.2.0] - 2026-09-12

### Fixed

- The documented release command could not release anything. It said `git tag`
  followed by `git push --follow-tags`, but `--follow-tags` pushes annotated
  tags and silently skips lightweight ones, so the tag stayed on the machine
  and the release workflow never fired while the push reported success. Every
  copy of the instructions now uses `git tag -a`.

### Added

- CLAUDE.md and AGENTS.md stating how this repository is developed: the two
  design rules, and the Superpowers skill to reach for at each point of the
  work. Claude Code loads CLAUDE.md automatically, so the workflow applies to
  any contributing agent without anyone having to remember it.
- `npm run check-docs`, wired into `verify` and CI, so the contributor
  documentation cannot rot into broken links or quietly lose a rule.
- A pull request template that asks how the change was built, and for the
  subagent report when an agent built it.
- The Superpowers plugin is declared in a committed .claude/settings.json, so
  Claude Code offers to enable it when the project is opened and a contributor
  installs nothing by hand.
- A banner in the README, at `docs/banner.png`.
- docs/releasing.md: how a change reaches an installed copy, why a version bump
  is mandatory for the plugin, how to choose the number, and what to do about a
  bad release. README documents the two update commands a user needs.

### Changed

- `/agent-observer:subagent-report` now takes the same arguments as the command
  line tool. It had its own parallel vocabulary, where the tree was `--tree`
  rather than `tree`, which meant two spellings for one idea and no explanation
  of why. Every command is reachable through it now, including `watch`,
  `adapters`, `doctor` and the CSV and Markdown output formats, none of which it
  could previously reach. The older flag spellings still work.
- The README documented the slash command as `/subagent-report`. Plugin commands
  are namespaced, so the reliable form is `/agent-observer:subagent-report`; the
  bare name resolves only while nothing else has claimed it. `check-docs` now
  verifies that every command the docs mention is one the plugin ships, and that
  every shipped command is documented.
- The README opens on what agents and harnesses do, running workflows by
  dispatching subagents, rather than on a product. Claude Code and Superpowers
  are named only as examples. The core knows nothing about either, and any agent
  can be read through its own adapter or the common event format.

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

[Unreleased]: https://github.com/mbecca/agent-observer/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/mbecca/agent-observer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/mbecca/agent-observer/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mbecca/agent-observer/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/mbecca/agent-observer/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/mbecca/agent-observer/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/mbecca/agent-observer/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/mbecca/agent-observer/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mbecca/agent-observer/releases/tag/v0.1.0
