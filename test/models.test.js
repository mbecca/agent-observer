import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normaliseModel } from '../src/adapters/models.js';
import { normaliseModel as fromClaudeCode } from '../src/adapters/claude-code.js';

describe('normaliseModel from src/adapters/models.js', () => {
  it('trims a full API id down to its family', () => {
    assert.equal(normaliseModel('claude-sonnet-4-5-20250929'), 'sonnet');
  });

  it('is the same function re-exported by the Claude Code adapter', () => {
    assert.equal(fromClaudeCode, normaliseModel);
    assert.equal(fromClaudeCode('claude-sonnet-4-5-20250929'), 'sonnet');
  });
});
