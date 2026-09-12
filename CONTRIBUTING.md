# Contributing

Thanks for looking. This project has no dependencies, runtime or development, so
getting started is short:

```bash
git clone https://github.com/beccariamatias/agent-observer.git
cd agent-observer
npm run verify
```

`npm run verify` parses every file, checks the version declarations agree,
validates the plugin manifests and runs the tests. CI runs the same thing on
Windows, Linux and macOS across Node 18, 20, 22 and 24.

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

Maintainers only, and tag-driven:

```bash
npm version minor
node scripts/sync-version.mjs
# add the CHANGELOG.md entry
git commit -am "Release v0.2.0"
git push --follow-tags
```

The release workflow refuses to publish unless the tag, `package.json`,
`plugin.json`, `marketplace.json`, `src/version.js` and the changelog all declare
the same version.
