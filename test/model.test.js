import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AgentRun,
  EVENT_SCHEMA_VERSION,
  Session,
  inferRole,
  parseTimestamp,
  tally,
} from '../src/core/model.js';

describe('inferRole', () => {
  it('reads the leading verb of a task description', () => {
    assert.equal(inferRole('Implement Task 1: plan workflow'), 'implement');
    assert.equal(inferRole('Review Task 1 (spec + quality)'), 'review');
    assert.equal(inferRole('Explore docker build/tag jobs'), 'explore');
    assert.equal(inferRole('Plan the migration'), 'plan');
  });

  it('prefers the leading verb over words later in the string', () => {
    // "Fix final-review findings" is a fix, even though it mentions a review.
    assert.equal(inferRole('Fix final-review findings'), 'fix');
    assert.equal(inferRole('Implement the review screen'), 'implement');
  });

  it('falls back to scanning the whole description', () => {
    assert.equal(inferRole('Scoped re-review of the fix wave'), 'review');
    assert.equal(inferRole('Task 4: verify on PR #26'), 'test');
  });

  it('returns unknown for an empty or unrecognisable task', () => {
    assert.equal(inferRole(null), 'unknown');
    assert.equal(inferRole(''), 'unknown');
    assert.equal(inferRole('zzz qqq'), 'unknown');
  });

  it('uses the agent type when there is no description', () => {
    assert.equal(inferRole(null, 'Explore'), 'explore');
  });
});

describe('parseTimestamp', () => {
  it('parses ISO-8601 with a Z suffix', () => {
    const parsed = parseTimestamp('2026-08-14T13:34:55.123Z');
    assert.equal(parsed.toISOString(), '2026-08-14T13:34:55.123Z');
  });

  it('parses ISO-8601 with a numeric offset', () => {
    const parsed = parseTimestamp('2026-08-14T13:34:55+02:00');
    assert.equal(parsed.toISOString(), '2026-08-14T11:34:55.000Z');
  });

  it('treats small numbers as seconds and large ones as milliseconds', () => {
    assert.equal(parseTimestamp(1755178495).toISOString(), parseTimestamp(1755178495000).toISOString());
  });

  it('returns null for junk rather than an Invalid Date', () => {
    assert.equal(parseTimestamp('not a date'), null);
    assert.equal(parseTimestamp(null), null);
    assert.equal(parseTimestamp(''), null);
    assert.equal(parseTimestamp({}), null);
  });

  it('passes a Date through', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    assert.equal(parseTimestamp(date), date);
  });
});

describe('AgentRun', () => {
  it('infers a role when none is given', () => {
    const run = new AgentRun({ task: 'Review Task 2 (spec + quality)' });
    assert.equal(run.role, 'review');
  });

  it('keeps an explicit role over the inferred one', () => {
    const run = new AgentRun({ task: 'Review Task 2', role: 'implement' });
    assert.equal(run.role, 'implement');
  });

  it('computes duration only when both ends are known', () => {
    const started = new Date('2026-08-14T13:34:55Z');
    const finished = new Date('2026-08-14T13:36:23Z');
    assert.equal(new AgentRun({ startedAt: started, finishedAt: finished }).durationSeconds, 88);
    assert.equal(new AgentRun({ startedAt: started }).durationSeconds, null);
    assert.equal(new AgentRun({}).durationSeconds, null);
  });

  it('refuses a negative duration from clock skew', () => {
    const run = new AgentRun({
      startedAt: new Date('2026-08-14T13:36:23Z'),
      finishedAt: new Date('2026-08-14T13:34:55Z'),
    });
    assert.equal(run.durationSeconds, null);
  });

  it('round-trips through the common event format', () => {
    const run = new AgentRun({
      provider: 'claude-code',
      sessionId: 'session-1',
      agentId: 'agent-a1',
      agentType: 'general-purpose',
      model: 'haiku',
      task: 'Implement Task 1',
      spawnDepth: 1,
      startedAt: new Date('2026-08-14T13:34:55Z'),
      finishedAt: new Date('2026-08-14T13:36:23Z'),
      turns: 12,
      toolUseId: 'toolu_x',
    });

    const restored = AgentRun.fromEvent(run.toEvent());
    assert.equal(restored.provider, run.provider);
    assert.equal(restored.sessionId, run.sessionId);
    assert.equal(restored.agentId, run.agentId);
    assert.equal(restored.model, run.model);
    assert.equal(restored.role, run.role);
    assert.equal(restored.spawnDepth, run.spawnDepth);
    assert.equal(restored.turns, run.turns);
    assert.equal(restored.startedAt.toISOString(), run.startedAt.toISOString());
    assert.equal(restored.finishedAt.toISOString(), run.finishedAt.toISOString());
  });

  it('stamps the schema version on every event', () => {
    assert.equal(new AgentRun({}).toEvent().schema_version, EVENT_SCHEMA_VERSION);
  });

  it('accepts a legacy event that uses description and timestamp', () => {
    const run = AgentRun.fromEvent({
      provider: 'other',
      session_id: 's',
      id: 'a',
      description: 'Review the change',
      timestamp: '2026-08-14T13:34:55Z',
    });
    assert.equal(run.agentId, 'a');
    assert.equal(run.task, 'Review the change');
    assert.equal(run.role, 'review');
    assert.equal(run.startedAt.toISOString(), '2026-08-14T13:34:55.000Z');
  });
});

describe('Session', () => {
  const build = () =>
    new Session({
      provider: 'claude-code',
      sessionId: 's1',
      agents: [
        new AgentRun({ agentId: 'c', model: 'sonnet', task: 'Review Task 1', startedAt: new Date(3000) }),
        new AgentRun({ agentId: 'a', model: 'haiku', task: 'Implement Task 1', startedAt: new Date(1000) }),
        new AgentRun({ agentId: 'b', model: 'sonnet', task: 'Review Task 2', startedAt: new Date(2000) }),
      ],
    });

  it('sorts agents chronologically', () => {
    assert.deepEqual(
      build()
        .sortedAgents()
        .map((a) => a.agentId),
      ['a', 'b', 'c'],
    );
  });

  it('puts undated agents last without losing them', () => {
    const session = build();
    session.agents.push(new AgentRun({ agentId: 'z', model: 'opus' }));
    const order = session.sortedAgents().map((a) => a.agentId);
    assert.deepEqual(order, ['a', 'b', 'c', 'z']);
    assert.equal(session.agentCount, 4);
  });

  it('counts models highest-first', () => {
    assert.deepEqual(build().modelCounts(), { sonnet: 2, haiku: 1 });
  });

  it('counts a missing model as unknown', () => {
    const session = new Session({ agents: [new AgentRun({ agentId: 'a' })] });
    assert.deepEqual(session.modelCounts(), { unknown: 1 });
  });

  it('counts roles', () => {
    assert.deepEqual(build().roleCounts(), { review: 2, implement: 1 });
  });

  it('serialises to JSON with its agents ordered', () => {
    const json = build().toJSON();
    assert.equal(json.session_id, 's1');
    assert.equal(json.agent_count, 3);
    assert.deepEqual(
      json.agents.map((a) => a.agent_id),
      ['a', 'b', 'c'],
    );
  });
});

describe('tally', () => {
  it('orders by count then alphabetically', () => {
    assert.deepEqual(tally(['b', 'a', 'b', 'c', 'a', 'b']), { b: 3, a: 2, c: 1 });
  });

  it('returns an empty object for no values', () => {
    assert.deepEqual(tally([]), {});
  });
});
