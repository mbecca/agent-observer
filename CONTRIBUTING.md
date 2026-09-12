# Contributing

Thanks for looking. This project has no dependencies, runtime or development, so
getting started is short:

```bash
git clone https://github.com/mbecca/agent-observer.git
cd agent-observer
npm run verify
```

`npm run verify` parses every file, checks the version declarations agree,
validates the plugin manifests and runs the tests. CI runs the same thing on
Windows, Linux and macOS across Node 18, 20, 22 and 24.

## Working with a coding agent

This project is developed using the [Superpowers](https://github.com/obra/superpowers)
skills, and there is a reason beyond taste: agent-observer exists to report how
orchestrators route models across subagents, so it should be built by one.

If you are driving Claude Code you do not have to install anything. The
repository declares the plugin in `.claude/settings.json`, so Claude Code offers
to enable it the first time you open the project. Accept, and the skills are
there.

To do it by hand, or to check what you have:

```
/plugin install superpowers@claude-plugins-official
/plugin marketplace list
```

[CLAUDE.md](CLAUDE.md) is loaded automatically and tells the agent which skill
to use at which point: brainstorming before design, a written plan before code,
test-driven development while writing it, systematic debugging when something
breaks, and a review before the pull request.

Using another agent, or none, is fine. [AGENTS.md](AGENTS.md) states the same
workflow without the Claude-specific tooling. What the project asks for is the
discipline, not the plugin.

### Show your work

If subagents did the work, include their report in the pull request:

```bash
node bin/agent-observer.js session <session-id> --format markdown --no-color
```

It tells a reviewer how the change was produced, and it is the most honest test
this project has of whether its own output is worth reading.

## The design rule

The core knows nothing about any particular agent. Anything Claude-specific,
Codex-specific or otherwise product-specific belongs in an adapter.

The second rule follows from the first: **an adapter reports only what it can
observe.** If an agent does not record which model ran a subagent, the adapter
leaves the field empty and says so in its capability. Never infer a model from a
plan, a skill file, or what an agent said it would do. Reporting what actually
happened is the whole point of the tool.

## Adding an adapter

See [docs/writing-an-adapter.md](docs/writing-an-adapter.md). It is one file
plus one line in `src/adapters/index.js`, and every command and output format
then works with it.

## Tests

Tests run against fixture directories written in the real on-disk shape, not
against mocks. The layout on disk is the thing that breaks; a mock will agree
with whatever assumption you brought to it.

`test/helpers.js` has the builders. Add a case for the failure modes, not just
the happy path: a missing root, a corrupt record, a half-written file, a
subagent still running.

## Code style

Two-space indent, ES modules, no semicolon-free style. Comments explain why, not
what. If a comment restates the line below it, delete it.

Keep output readable at 80 columns and correct with `--no-color`, since people
pipe it into other tools.

## Commits and pull requests

One logical change per pull request. Describe what changed and why; if it fixes
something, say what was wrong. Run `npm run verify` before pushing.

## Releasing

Maintainers only. The full process, including how to pick the number and what
to do about a bad release, is in [docs/releasing.md](docs/releasing.md).

The short version, tag-driven:

```bash
node scripts/sync-version.mjs 0.2.0
# move the Unreleased changelog entries under a 0.2.0 heading
npm run verify
git commit -am "Release v0.2.0"
git tag v0.2.0
git push --follow-tags
```

The release workflow refuses to publish unless the tag, `package.json`,
`plugin.json`, `marketplace.json`, `src/version.js` and the changelog all declare
the same version.

Bump the version for anything a user would notice, a change to `SKILL.md`
included. Claude Code caches the plugin by version, so a fix pushed without a
bump never reaches an installed copy while `/plugin marketplace update` reports
success.
