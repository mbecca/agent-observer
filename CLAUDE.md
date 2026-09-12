# Working on agent-observer

This file is loaded automatically by Claude Code. If you are an agent working in
this repository, it applies to you.

## What this project is

A tool that reports which subagents a coding-agent session dispatched, with
which model, for which task, read from the agent's own on-disk metadata. It
exists because an orchestrator's account of what it delegated is not evidence,
and the metadata is.

That premise constrains how the code is written and how it is changed.

## Two rules that are not negotiable

**The core knows nothing about any particular agent.** Anything specific to
Claude Code, Codex or any other product lives in `src/adapters/`. If a change
puts a product name into `src/core/`, it is the wrong change.

**An adapter reports only what it can observe.** When an agent does not record
which model ran a subagent, the adapter leaves the field null and names the gap
in `capability().missing`. Never infer a model from a plan, a skill file, or
what an agent said it would do. A tool built to expose the difference between
intent and reality must not guess.

## Use Superpowers for the work

This repository is developed with the Superpowers skills. Use them rather than
working ad hoc. They are what this tool was built to observe, so using them here
is also how the project dogfoods itself.

Invoke them by name with the Skill tool. The mapping from situation to skill:

| Situation | Skill |
|---|---|
| Any change beyond a typo, before writing code | `superpowers:brainstorming` |
| A multi-step change, once requirements are clear | `superpowers:writing-plans` |
| Executing a plan with independent tasks | `superpowers:subagent-driven-development` |
| Executing a plan in a separate session | `superpowers:executing-plans` |
| Writing any feature or bugfix | `superpowers:test-driven-development` |
| A bug, test failure or surprise | `superpowers:systematic-debugging` |
| Before claiming anything works | `superpowers:verification-before-completion` |
| Before opening a pull request | `superpowers:requesting-code-review` |
| Acting on review feedback | `superpowers:receiving-code-review` |
| Work is done and needs integrating | `superpowers:finishing-a-development-branch` |

Start with `superpowers:brainstorming`. Do not skip it because a change looks
small: most of the bugs this project has already shipped looked small.

### Model selection when dispatching

`superpowers:subagent-driven-development` asks for the least powerful model that
can do each job. For this codebase that means:

- **Implementation against a written plan** is mechanical. Use a fast, cheap
  model. Adapters and renderers are well specified by their tests.
- **Review** needs judgement. Use a standard model.
- **The final whole-branch review** decides whether the work ships. Use the most
  capable model available, not the session default.
- **Anything touching the common event format** in `docs/event-format.md` is an
  interface change other people build against. Treat it as architecture and use
  the most capable model.

## Commands

```bash
npm run verify          # everything below, in one go
npm test                # Node's built-in runner, fixtures on disk
npm run lint            # parse every file
npm run validate-plugin # plugin and marketplace manifests
npm run check-version   # every version declaration agrees
```

There are no dependencies, runtime or development. Keep it that way. A pull
request that adds one needs to justify it against the cost of losing a
zero-install tool.

## Testing

Tests run against fixture directories written in the real on-disk shape, never
against mocks. The on-disk layout is the thing that breaks, and a mock will
agree with whatever assumption you brought to it. `test/helpers.js` has the
builders.

Cover the failure modes, not just the happy path: a missing root, a corrupt
record, a half-written file, a subagent still running, a path recorded on a
different operating system.

That last one is not hypothetical. `path.basename` only knows the separator of
the platform it runs on, and a Windows path went unshortened on Linux through a
full green CI run on Windows alone. Cross-platform bugs here are real.

## Before you say it works

Run `npm run verify` and read the output. CI runs Windows, Linux and macOS
across Node 18, 20, 22 and 24, and this project has already had a change pass on
one platform and fail on the other two.

Then run the tool against real data, not only fixtures:

```bash
node bin/agent-observer.js doctor
node bin/agent-observer.js sessions
```

## Dogfooding

If you used subagents to do the work, report them in the pull request:

```bash
node bin/agent-observer.js session <session-id> --format markdown --no-color
```

Paste that table into the description. It shows a reviewer how the change was
actually produced, and it is the most direct test this project has of whether
its own output is useful.

## Releasing

Maintainers only. Tag-driven, and the version bump matters: Claude Code caches
the plugin under its version directory, so a fix pushed without a bump never
reaches an installed copy.

```bash
node scripts/sync-version.mjs 0.2.0   # propagates to all five declarations
# add the CHANGELOG.md entry
git commit -am "Release v0.2.0" && git push --follow-tags
```
