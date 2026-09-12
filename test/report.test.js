import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AgentRun, Session } from '../src/core/model.js';
import {
  Painter,
  aggregateModels,
  aggregateRoles,
  groupIntoWaves,
  renderCapabilities,
  renderModels,
  renderSession,
  renderSessionsTable,
  renderTimeline,
  renderTree,
  toCsv,
  toJson,
  toMarkdown,
  toNdjson,
  waveTitle,
} from '../src/core/report.js';
import { Capability } from '../src/core/model.js';

const plain = new Painter(false);

function run(task, model, minute) {
  return new AgentRun({
    provider: 'claude-code',
    sessionId: 's1',
    agentId: `agent-${minute}`,
    agentType: 'general-purpose',
    model,
    task,
    startedAt: new Date(Date.UTC(2026, 7, 14, 13, minute, 0)),
    finishedAt: new Date(Date.UTC(2026, 7, 14, 13, minute + 1, 0)),
  });
}

function sddSession() {
  return new Session({
    provider: 'claude-code',
    sessionId: 's1',
    project: 'my-repo',
    projectPath: '/home/dev/my-repo',
    startedAt: new Date(Date.UTC(2026, 7, 14, 13, 34, 0)),
    updatedAt: new Date(Date.UTC(2026, 7, 14, 14, 18, 0)),
    agents: [
      run('Implement Task 1: plan workflow', 'haiku', 34),
      run('Review Task 1 (spec + quality)', 'sonnet', 36),
      run('Implement Task 2: apply workflow', 'haiku', 41),
      run('Review Task 2 (spec + quality)', 'sonnet', 42),
      run('Final whole-branch review', 'opus', 55),
    ],
  });
}

describe('groupIntoWaves', () => {
  it('starts a new wave when implementation follows a review', () => {
    const waves = groupIntoWaves(sddSession().sortedAgents());
    assert.equal(waves.length, 2);
    assert.deepEqual(
      waves[0].map((a) => a.model),
      ['haiku', 'sonnet'],
    );
    assert.deepEqual(
      waves[1].map((a) => a.model),
      ['haiku', 'sonnet', 'opus'],
    );
  });

  it('keeps a single implementation in one wave', () => {
    const waves = groupIntoWaves([run('Implement one thing', 'haiku', 1)]);
    assert.equal(waves.length, 1);
    assert.equal(waves[0].length, 1);
  });

  it('returns nothing for no agents', () => {
    assert.deepEqual(groupIntoWaves([]), []);
  });
});

describe('waveTitle', () => {
  it('strips the leading verb from the opening task', () => {
    assert.equal(waveTitle([run('Implement Task 1: plan workflow', 'haiku', 1)], 1), 'Task 1: plan workflow');
  });

  it('falls back to a numbered wave when the task is empty', () => {
    assert.equal(waveTitle([new AgentRun({ agentId: 'a' })], 3), 'Wave 3');
  });
});

describe('text renderers', () => {
  it('lists every subagent in the session table', () => {
    const text = renderSession(sddSession(), plain, { width: 120 });
    assert.match(text, /Session s1/);
    assert.match(text, /Implement Task 1: plan workflow/);
    assert.match(text, /Final whole-branch review/);
    assert.match(text, /haiku/);
    assert.match(text, /opus/);
  });

  it('shows the model tally under the table', () => {
    const text = renderSession(sddSession(), plain, { width: 120 });
    assert.match(text, /Models/);
    assert.match(text, /sonnet\s+2/);
    assert.match(text, /haiku\s+2/);
  });

  it('says so plainly when a session has no subagents', () => {
    const empty = new Session({ sessionId: 's0', provider: 'claude-code' });
    assert.match(renderSession(empty, plain), /No subagents recorded/);
    assert.match(renderTree(empty, plain), /No subagents recorded/);
  });

  it('groups the tree into waves with a model per leaf', () => {
    const text = renderTree(sddSession(), plain);
    assert.match(text, /Task 1: plan workflow/);
    assert.match(text, /Review Task 1/);
    assert.match(text, /opus/);
  });

  it('builds a sessions table with one column per model', () => {
    const text = renderSessionsTable([sddSession()], plain);
    assert.match(text, /SESSION/);
    assert.match(text, /my-repo/);
    assert.match(text, /1 session\(s\), 5 subagent\(s\)/);
  });

  it('reports an empty session list rather than printing a bare header', () => {
    assert.match(renderSessionsTable([], plain), /No sessions with subagents found/);
  });

  it('renders a timeline in chronological order', () => {
    const text = renderTimeline([sddSession()], plain);
    const lines = text.split('\n');
    assert.equal(lines.length, 5);
    assert.match(lines[0], /Implement Task 1/);
    assert.match(lines[4], /Final whole-branch review/);
  });

  it('shows model shares that add up', () => {
    const text = renderModels([sddSession()], plain);
    assert.match(text, /total 5 subagent\(s\)/);
    assert.match(text, /haiku/);
  });

  it('lists what an adapter cannot observe, not just what it can', () => {
    const cap = new Capability({
      provider: 'codex',
      displayName: 'OpenAI Codex CLI',
      available: false,
      root: '/home/dev/.codex',
      missing: ['per-subagent model'],
      note: 'Rollouts carry no subagent metadata.',
    });
    const text = renderCapabilities([cap], plain);
    assert.match(text, /OpenAI Codex CLI/);
    assert.match(text, /not found/);
    assert.match(text, /per-subagent model/);
    assert.match(text, /Rollouts carry no subagent metadata/);
  });
});

describe('Painter', () => {
  it('emits no escape codes when disabled', () => {
    assert.equal(plain.paint('hello', 'bold'), 'hello');
    assert.equal(plain.model('haiku'), 'haiku');
  });

  it('colours a model by family, matching a full API id too', () => {
    const colour = new Painter(true);
    assert.notEqual(colour.model('claude-haiku-4-5'), 'claude-haiku-4-5');
    assert.ok(colour.model('haiku').includes('haiku'));
  });

  it('labels a missing model as unknown', () => {
    assert.equal(plain.model(null), 'unknown');
  });
});

describe('aggregation', () => {
  it('sums models across sessions', () => {
    assert.deepEqual(aggregateModels([sddSession(), sddSession()]), {
      haiku: 4,
      sonnet: 4,
      opus: 2,
    });
  });

  it('sums roles across sessions', () => {
    assert.deepEqual(aggregateRoles([sddSession()]), { implement: 2, review: 3 });
  });

  it('returns nothing for no sessions', () => {
    assert.deepEqual(aggregateModels([]), {});
  });
});

describe('machine formats', () => {
  it('produces valid JSON carrying the schema version', () => {
    const parsed = JSON.parse(toJson([sddSession()]));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].schema_version, '1.0');
    assert.equal(parsed[0].agent_count, 5);
    assert.equal(parsed[0].agents[0].model, 'haiku');
  });

  it('produces one parsable event per ndjson line', () => {
    const lines = toNdjson([sddSession()]).split('\n');
    assert.equal(lines.length, 5);
    const first = JSON.parse(lines[0]);
    assert.equal(first.session_id, 's1');
    assert.equal(first.project, 'my-repo');
    assert.equal(first.role, 'implement');
  });

  it('writes a CSV header plus one row per subagent', () => {
    const rows = toCsv([sddSession()]).split('\n');
    assert.equal(rows.length, 6);
    assert.match(rows[0], /^provider,session_id,project/);
  });

  it('quotes CSV fields containing commas or quotes', () => {
    const session = new Session({
      sessionId: 's1',
      provider: 'x',
      agents: [new AgentRun({ agentId: 'a', task: 'Fix a, b and "c"' })],
    });
    const row = toCsv([session]).split('\n')[1];
    assert.match(row, /"Fix a, b and ""c"""/);
  });

  it('escapes pipes in markdown so the table does not break', () => {
    const session = new Session({
      sessionId: 's1',
      provider: 'x',
      agents: [new AgentRun({ agentId: 'a', task: 'Run a | b' })],
    });
    assert.match(toMarkdown([session]), /Run a \\\| b/);
  });

  it('renders a markdown table with a model summary', () => {
    const text = toMarkdown([sddSession()]);
    assert.match(text, /## Session `s1`/);
    assert.match(text, /\| # \| Time \| Model \|/);
    assert.match(text, /\*\*Models:\*\*/);
  });
});
