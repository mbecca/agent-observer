# Common event format

One JSON object per line. This is the contract between agent-observer's core and
everything else: the `generic` adapter reads it, `export --format ndjson` writes
it, and any agent that emits it becomes observable without a line of code in
this repository.

## A line

```json
{
  "schema_version": "1.0",
  "provider": "claude-code",
  "session_id": "3a372c2d-5be3-43b6-a7d5-29cc9e032cd7",
  "agent_id": "agent-a26dac88cbda83a70",
  "parent_agent_id": null,
  "agent_type": "general-purpose",
  "model": "haiku",
  "role": "implement",
  "task": "Implement Task 1: plan workflow",
  "status": "completed",
  "spawn_depth": 1,
  "started_at": "2026-08-14T13:34:55.000Z",
  "finished_at": "2026-08-14T13:36:23.000Z",
  "duration_seconds": 88,
  "turns": 14,
  "tool_use_id": "toolu_01GBaUDaZqJ2dcjVePwSFbdX",
  "source_path": "/home/dev/.claude/projects/.../agent-a26.meta.json",
  "project": "my-repo"
}
```

## Fields

Three fields are required. Everything else is optional, and omitting a field is
the correct way to say "this agent does not record that". Never fill a field
with a placeholder.

| Field | Required | Meaning |
|---|---|---|
| `provider` | yes | Which agent produced this, e.g. `claude-code`. |
| `session_id` | yes | The top-level session the subagent belongs to. |
| `agent_id` | yes | Unique within the session. |
| `schema_version` | no | Defaults to `1.0` when absent. |
| `parent_agent_id` | no | The dispatching agent, for nested spawns. |
| `agent_type` | no | The agent definition used, e.g. `general-purpose`. |
| `model` | no | The model that actually ran. `inherit` is a real value. |
| `role` | no | Inferred from `task` when absent. See below. |
| `task` | no | What the subagent was asked to do. |
| `status` | no | `spawned`, `completed` or `unknown`. |
| `spawn_depth` | no | 0 for the session itself, 1 for its direct subagents. |
| `started_at` | no | ISO-8601. `timestamp` is accepted as an alias. |
| `finished_at` | no | ISO-8601. |
| `duration_seconds` | no | Recomputed from the two timestamps when both exist. |
| `turns` | no | Messages in the subagent's transcript. |
| `tool_use_id` | no | Ties the run back to the dispatching tool call. |
| `source_path` | no | Where the record was read from. |
| `project` | no | Short project label, used for grouping and filtering. |
| `project_path` | no | Absolute path to the project. |
| `extra` | no | Any provider-specific fields worth keeping. |

`description` is accepted as an alias for `task`, and `id` for `agent_id`, so
records written by an earlier tool still load.

## Roles

`implement`, `review`, `fix`, `test`, `plan`, `explore`, `document`, `unknown`.

When `role` is absent it is inferred from the task description, with the leading
verb winning: "Fix final-review findings" is a `fix`, not a `review`. An inferred
role is a convenience label, not something the agent reported. Set the field
explicitly when you know better.

## Emitting events

Write lines to a `.jsonl` file, then point the generic adapter at it:

```bash
export AGENT_OBSERVER_EVENTS=~/my-agent/events
agent-observer sessions --adapter generic
```

The path may be a single file or a directory; every `.jsonl` and `.ndjson` file
under a directory is read and grouped by `session_id`.

## Stability

Within major version 1, fields are only added, never removed or repurposed, and
a reader must ignore fields it does not recognise. `agent-observer export
--format ndjson` always emits the current version.
