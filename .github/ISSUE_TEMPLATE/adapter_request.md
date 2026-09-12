---
name: Adapter request
about: Ask for support for another coding agent
labels: adapter
---

## Which agent

Name, version, and a link.

## Where it stores session data

The directory, and whether an environment variable overrides it.

## What it records per subagent

The key question: does it write the model that ran each subagent, anywhere on
disk? If it does not, an adapter can only report the session, and that is worth
knowing up front.

- [ ] session id
- [ ] subagent id
- [ ] model per subagent
- [ ] task or description
- [ ] timestamps
- [ ] parent agent

## A sample record

Paste one record, with anything private removed.

```json

```

## Note

If the agent records nothing per subagent, you can still make it observable by
emitting the [common event format](../../docs/event-format.md) and using the
generic adapter. That needs no change to this project.
