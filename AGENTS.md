# Agent instructions

Read [CLAUDE.md](CLAUDE.md) first. Everything in it applies to you: the design
rules, the commands, the testing approach and the release process.

This file covers the one part that does not transfer.

## If you are not Claude Code

CLAUDE.md asks you to use the Superpowers skills. Those are a Claude Code
plugin, so you may not have them. The workflow they encode is not
Claude-specific, and it is what this repository expects either way:

1. **Understand before building.** Establish what is actually being asked and
   what the change has to satisfy. Write it down.
2. **Plan before coding.** For anything multi-step, write the plan as discrete
   tasks with the acceptance criteria for each.
3. **Test first.** Write the failing test, then the code that passes it. Every
   feature and every bugfix.
4. **Delegate with fresh context.** If your harness supports subagents, give
   each task its own worker with only the context that task needs, and review
   each result before moving on. Never let a worker inherit the whole session.
5. **Match the model to the job.** Cheap and fast for mechanical implementation,
   standard for review and integration, the most capable you have for the final
   whole-branch pass and for anything that changes the common event format.
6. **Debug systematically.** Find the cause before proposing a fix. A test that
   fails on one platform is a bug, not a flake.
7. **Verify before claiming.** Run `pnpm run verify`, read the output, and only
   then say it works.
8. **Review before merging.** Get the change reviewed against the plan and
   against these rules.

The Superpowers implementations of these are at
<https://github.com/obra/superpowers> if you want the detail.

## Making yourself observable

This project reports subagent routing for agents that record it. Claude Code
does. Many do not.

If your harness writes its own dispatch records, you can make it observable
without changing any code here: emit one JSON object per line in the format at
[docs/event-format.md](docs/event-format.md), then point the generic adapter at
the file.

```bash
export AGENT_OBSERVER_EVENTS=~/my-agent/events
node bin/agent-observer.js sessions --adapter generic
```

If your harness records nothing per subagent, say so rather than approximating.
That is the same standard the adapters are held to, and
[docs/writing-an-adapter.md](docs/writing-an-adapter.md) explains why.
