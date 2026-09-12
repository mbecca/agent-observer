import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  baseName,
  countLines,
  firstLastLine,
  humanDuration,
  parseSince,
  readHead,
  readJson,
  readJsonl,
  truncate,
} from '../src/core/util.js';
import { makeTempDir, removeDir } from './helpers.js';

describe('baseName', () => {
  // path.basename only knows the separator of the platform it runs on, so on
  // Linux it returns a Windows path unchanged. Paths here come out of an
  // agent's own files and may have been recorded on the other OS.
  it('handles a Windows path on any platform', () => {
    assert.equal(baseName('C:\\Users\\dev\\work\\my-repo'), 'my-repo');
  });

  it('handles a POSIX path on any platform', () => {
    assert.equal(baseName('/home/dev/work/my-repo'), 'my-repo');
  });

  it('ignores a trailing separator of either kind', () => {
    assert.equal(baseName('C:\\Users\\dev\\my-repo\\'), 'my-repo');
    assert.equal(baseName('/home/dev/my-repo/'), 'my-repo');
  });

  it('handles a mixed-separator path', () => {
    assert.equal(baseName('C:/Users/dev\\my-repo'), 'my-repo');
  });

  it('returns a bare name unchanged', () => {
    assert.equal(baseName('my-repo'), 'my-repo');
  });

  it('returns an empty string for nothing', () => {
    assert.equal(baseName(''), '');
    assert.equal(baseName(null), '');
    assert.equal(baseName(undefined), '');
  });

  it('has no basename for a root path, matching path.basename', () => {
    // Callers treat an empty result as "no usable label" and fall back.
    assert.equal(baseName('/'), '');
    assert.equal(baseName('C:\\'), 'C:');
  });
});

describe('parseSince', () => {
  it('reads a duration in minutes, hours, days and weeks', () => {
    const now = Date.now();
    assert.ok(Math.abs(now - parseSince('30m').getTime() - 30 * 60e3) < 1000);
    assert.ok(Math.abs(now - parseSince('12h').getTime() - 12 * 3600e3) < 1000);
    assert.ok(Math.abs(now - parseSince('7d').getTime() - 7 * 86400e3) < 1000);
    assert.ok(Math.abs(now - parseSince('2w').getTime() - 14 * 86400e3) < 1000);
  });

  it('reads an absolute ISO date', () => {
    assert.equal(parseSince('2026-08-14T00:00:00Z').toISOString(), '2026-08-14T00:00:00.000Z');
  });

  it('explains the accepted forms when it cannot parse', () => {
    assert.throws(() => parseSince('soonish'), /Use 7d, 12h, 30m or an ISO date/);
  });
});

describe('humanDuration', () => {
  it('formats seconds, minutes and hours', () => {
    assert.equal(humanDuration(45), '45s');
    assert.equal(humanDuration(88), '1m28s');
    assert.equal(humanDuration(635), '10m35s');
    assert.equal(humanDuration(3900), '1h05m');
  });

  it('shows a dash when the duration is unknown', () => {
    assert.equal(humanDuration(null), '-');
    assert.equal(humanDuration(undefined), '-');
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    assert.equal(truncate('short', 20), 'short');
  });

  it('adds an ellipsis when cutting', () => {
    assert.equal(truncate('a'.repeat(30), 10), 'a'.repeat(9) + '…');
  });

  it('flattens newlines so a table row stays one line', () => {
    assert.equal(truncate('two\nlines', 20), 'two lines');
  });

  it('handles nothing', () => {
    assert.equal(truncate(null, 10), '');
  });
});

describe('file readers', () => {
  let dir;

  before(() => {
    dir = makeTempDir();
  });

  after(() => removeDir(dir));

  it('returns null for a missing or malformed JSON file', () => {
    assert.equal(readJson(path.join(dir, 'nope.json')), null);
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{ not json');
    assert.equal(readJson(bad), null);
  });

  it('returns null for JSON that is not an object', () => {
    const arrayFile = path.join(dir, 'array.json');
    fs.writeFileSync(arrayFile, '[1,2,3]');
    assert.equal(readJson(arrayFile), null);
  });

  it('skips unparsable and blank lines in a jsonl file', () => {
    const file = path.join(dir, 'mixed.jsonl');
    fs.writeFileSync(file, '{"a":1}\n\n{ broken\n{"b":2}\n');
    assert.deepEqual(readJsonl(file), [{ a: 1 }, { b: 2 }]);
  });

  it('returns an empty list for a missing jsonl file', () => {
    assert.deepEqual(readJsonl(path.join(dir, 'nope.jsonl')), []);
  });

  it('finds the first and last non-empty lines', () => {
    const file = path.join(dir, 'ends.jsonl');
    fs.writeFileSync(file, '\nfirst\nmiddle\nlast\n\n');
    assert.deepEqual(firstLastLine(file), ['first', 'last']);
  });

  it('finds both ends of a file larger than the read window', () => {
    // The tail is read by seeking, so a big file must still give the real ends.
    const file = path.join(dir, 'big.jsonl');
    const filler = Array.from({ length: 5000 }, (_, i) => `{"n":${i}}`).join('\n');
    fs.writeFileSync(file, `{"first":true}\n${filler}\n{"last":true}\n`);
    const [first, last] = firstLastLine(file, 4096);
    assert.equal(first, '{"first":true}');
    assert.equal(last, '{"last":true}');
  });

  it('returns nulls for a missing or empty file', () => {
    assert.deepEqual(firstLastLine(path.join(dir, 'nope')), [null, null]);
    const empty = path.join(dir, 'empty');
    fs.writeFileSync(empty, '');
    assert.deepEqual(firstLastLine(empty), [null, null]);
  });

  it('counts only non-empty lines', () => {
    const file = path.join(dir, 'count.jsonl');
    fs.writeFileSync(file, 'a\n\nb\n\n\nc\n');
    assert.equal(countLines(file), 3);
    assert.equal(countLines(path.join(dir, 'nope')), null);
  });

  it('reads a bounded head without loading the whole file', () => {
    const file = path.join(dir, 'head.txt');
    fs.writeFileSync(file, 'x'.repeat(10000));
    assert.equal(readHead(file, 100).length, 100);
    assert.equal(readHead(path.join(dir, 'nope')), null);
  });
});
