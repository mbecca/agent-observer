// test/insights.test.js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AgentRun, Session } from '../src/core/model.js';
import {
  dominantSubagent,
  insightsFor,
  leadingRole,
  modelRoleConcentration,
  outsideSubagents,
  theException,
} from '../src/core/insights.js';

/** Build a run with a known duration, in minutes for readability. */
function run(task, model, startMin, durSec) {
  const startedAt = new Date(Date.UTC(2026, 7, 14, 13, 34, 55) + startMin * 60000);
  return new AgentRun({
    provider: 'claude-code',
    sessionId: 's1',
    agentId: `a-${startMin}`,
    model,
    task,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + durSec * 1000),
  });
}

/** The real shape of session 3a372c2d: haiku implements, sonnet reviews, opus once. */
function sddSession() {
  return new Session({
    provider: 'claude-code',
    sessionId: 's1',
    agents: [
      run('Implement Task 1: plan workflow', 'haiku', 0, 88),
      run('Review Task 1 (spec + quality)', 'sonnet', 2, 214),
      run('Implement Task 2: apply workflow', 'haiku', 6, 79),
      run('Review Task 2 (spec + quality)', 'sonnet', 8, 116),
      run('Implement Task 3: AGENTS.md section', 'haiku', 10, 75),
      run('Review Task 3 (spec + quality)', 'sonnet', 12, 73),
      run('Implement Task 4: verify on PR #26', 'sonnet', 14, 254),
      run('Final whole-branch review', 'opus', 20, 635),
    ],
  });
}

describe('leadingRole', () => {
  it('picks the role with the most runs', () => {
    // 4 implement, 4 review -> tie, broken alphabetically
    assert.equal(leadingRole(sddSession()), 'implement');
  });

  it('returns null when there are no runs', () => {
    assert.equal(leadingRole(new Session({ sessionId: 's0' })), null);
  });
});

describe('modelRoleConcentration', () => {
  it('reports the model that did most of the leading role', () => {
    const text = modelRoleConcentration(sddSession());
    assert.match(text, /[Ii]mplementation ran on haiku in 3 of 4/);
  });

  it('stays silent below three runs of the leading role', () => {
    const small = new Session({
      sessionId: 's1',
      agents: [run('Implement one', 'haiku', 0, 60), run('Review one', 'sonnet', 2, 60)],
    });
    assert.equal(modelRoleConcentration(small), null);
  });

  it('stays silent when no model reaches two thirds', () => {
    const mixed = new Session({
      sessionId: 's1',
      agents: [
        run('Implement a', 'haiku', 0, 60),
        run('Implement b', 'sonnet', 2, 60),
        run('Implement c', 'opus', 4, 60),
      ],
    });
    assert.equal(modelRoleConcentration(mixed), null);
  });
});

describe('dominantSubagent', () => {
  it('names the longest subagent and its share', () => {
    const text = dominantSubagent(sddSession());
    assert.match(text, /Final whole-branch review/);
    assert.match(text, /4[0-9]%/); // 635 of 1534 seconds
  });

  it('stays silent below four timed subagents', () => {
    const three = new Session({
      sessionId: 's1',
      agents: [run('a', 'haiku', 0, 10), run('b', 'haiku', 1, 10), run('c', 'haiku', 2, 600)],
    });
    assert.equal(dominantSubagent(three), null);
  });

  it('stays silent when the longest is under a quarter of the time', () => {
    // Five equal runs put the longest at 20%. With only four, the longest is
    // always at least 25%, so a four-run fixture cannot test this threshold.
    const even = new Session({
      sessionId: 's1',
      agents: [
        run('a', 'haiku', 0, 100), run('b', 'haiku', 2, 100),
        run('c', 'haiku', 4, 100), run('d', 'haiku', 6, 100),
        run('e', 'haiku', 8, 100),
      ],
    });
    assert.equal(dominantSubagent(even), null);
  });
});

describe('theException', () => {
  it('names the single run that broke the pattern', () => {
    const text = theException(sddSession());
    assert.match(text, /One implementation ran on sonnet/);
    assert.match(text, /other three ran on haiku/);
  });

  it('stays silent when every run of the role used the same model', () => {
    const uniform = new Session({
      sessionId: 's1',
      agents: [
        run('Implement a', 'haiku', 0, 60),
        run('Implement b', 'haiku', 2, 60),
        run('Implement c', 'haiku', 4, 60),
      ],
    });
    assert.equal(theException(uniform), null);
  });
});

describe('outsideSubagents', () => {
  it('reports the share of elapsed time with no subagent running', () => {
    const text = outsideSubagents(sddSession());
    assert.match(text, /\d+% of elapsed time fell outside any subagent/);
  });

  it('stays silent when subagent time exceeds elapsed time', () => {
    // Overlapping runs: the gap is meaningless, so say nothing.
    const overlapping = new Session({
      sessionId: 's1',
      agents: [run('a', 'haiku', 0, 600), run('b', 'sonnet', 1, 600)],
    });
    assert.equal(outsideSubagents(overlapping), null);
  });
});

describe('insightsFor', () => {
  it('returns the qualifying sentences in a fixed order', () => {
    const lines = insightsFor(sddSession());
    assert.ok(lines.length >= 3);
    assert.match(lines[0], /[Ii]mplementation ran on haiku/);
  });

  it('returns nothing for a session that crosses no threshold', () => {
    const quiet = new Session({ sessionId: 's0', agents: [run('a', 'haiku', 0, 60)] });
    assert.deepEqual(insightsFor(quiet), []);
  });
});
