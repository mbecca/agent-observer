---
name: Bug report
about: Something reported the wrong thing, or nothing at all
labels: bug
---

## What happened

## What you expected

## Output of `agent-observer doctor`

```
paste here
```

This says which adapters were found, where they looked, and how much they saw.
It answers most "why is it empty" reports on its own.

## Environment

- agent-observer version (`agent-observer --version`):
- Node version (`node --version`):
- OS:
- Installed as: plugin / npm global / from source

## Anything else

If a session reports the wrong model or task, the relevant `.meta.json` under
`~/.claude/projects/<project>/<session>/subagents/` is the most useful thing to
include. Check it for anything you would rather not share before pasting.
