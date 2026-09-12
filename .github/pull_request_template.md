## What changed

## Why

## How it was built

Delete whichever does not apply.

- Built with a coding agent. Subagent report below, from
  `agent-observer session <id> --format markdown --no-color`.
- Built by hand.

<!-- paste the subagent table here, if there is one -->

## Checklist

- [ ] `pnpm run verify` passes
- [ ] Tests cover the change, including the failure cases
- [ ] Anything agent-specific lives in an adapter, not in `src/core/`
- [ ] No adapter infers data the agent does not actually record
- [ ] No new dependency, or the description says why one is worth it
- [ ] CHANGELOG.md updated under Unreleased
