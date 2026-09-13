/**
 * Interpretive sentences derived from a session.
 *
 * Every rule here is arithmetic a reader can recompute from the table beside
 * it. None of them is a judgement: "opus took 41% of subagent time" belongs
 * here, "the routing was wasteful" does not. Each rule has a declared
 * threshold and returns null below it, because a report that pads itself with
 * weak observations teaches the reader to skip the whole block.
 */

import { tally } from './model.js';

const CONCENTRATION_MIN_RUNS = 3;
const CONCENTRATION_SHARE = 2 / 3;
const DOMINANT_MIN_TIMED = 4;
const DOMINANT_SHARE = 0.25;
const OUTSIDE_SHARE = 0.1;

/**
 * The noun each role takes in a sentence. Without this the output reads
 * "Implement ran on haiku", which is not English.
 */
const ROLE_NOUNS = {
  implement: 'Implementation',
  review: 'Review',
  fix: 'Fixing',
  test: 'Testing',
  plan: 'Planning',
  explore: 'Exploration',
  document: 'Documentation',
  unknown: 'Work',
};

/** Runs that have a usable duration. */
function timed(session) {
  return session.agents.filter((a) => typeof a.durationSeconds === 'number');
}

/**
 * True only when every run in the session has a known duration. Rules 2 and 4
 * describe a share of *all* subagent or elapsed time; if even one run's
 * duration is unknown, that run may have filled the gap or dominated the
 * total, and the arithmetic the sentence reports would be a guess.
 */
function everyRunTimed(session) {
  return session.agents.length > 0 && session.agents.every((a) => typeof a.durationSeconds === 'number');
}

function subagentSeconds(session) {
  return timed(session).reduce((sum, a) => sum + a.durationSeconds, 0);
}

/** Earliest start to latest finish. Null unless both ends are known. */
function elapsedSeconds(session) {
  const starts = session.agents.map((a) => a.startedAt).filter(Boolean);
  const ends = session.agents.map((a) => a.finishedAt).filter(Boolean);
  if (!starts.length || !ends.length) return null;
  const span = (Math.max(...ends) - Math.min(...starts)) / 1000;
  return span > 0 ? span : null;
}

/** The role with the most runs. Ties break alphabetically so output is stable. */
export function leadingRole(session) {
  const counts = tally(session.agents.map((a) => a.role || 'unknown'));
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  const top = Math.max(...entries.map(([, n]) => n));
  return entries.filter(([, n]) => n === top).map(([role]) => role).sort()[0];
}

function leadingRuns(session) {
  const role = leadingRole(session);
  return role ? { role, runs: session.agents.filter((a) => (a.role || 'unknown') === role) } : null;
}

/** The model that dominates the leading role, or null. */
function dominantModelOf(runs) {
  const counts = tally(runs.map((a) => a.model || 'unknown'));
  const [model, count] = Object.entries(counts)[0] || [];
  if (!model) return null;
  return count / runs.length >= CONCENTRATION_SHARE ? { model, count } : null;
}

export function modelRoleConcentration(session) {
  const leading = leadingRuns(session);
  if (!leading || leading.runs.length < CONCENTRATION_MIN_RUNS) return null;
  const dominant = dominantModelOf(leading.runs);
  if (!dominant) return null;
  // Object.hasOwn guards against a role named e.g. "constructor" resolving to
  // an inherited Object.prototype member instead of falling through to
  // capitalise().
  const noun = Object.hasOwn(ROLE_NOUNS, leading.role) ? ROLE_NOUNS[leading.role] : capitalise(leading.role);
  return `${noun} ran on ${dominant.model} in ${dominant.count} of ${leading.runs.length} tasks.`;
}

export function dominantSubagent(session) {
  if (!everyRunTimed(session)) return null;
  const runs = timed(session);
  if (runs.length < DOMINANT_MIN_TIMED) return null;
  const total = subagentSeconds(session);
  if (!total) return null;
  const longest = runs.reduce((a, b) => (b.durationSeconds > a.durationSeconds ? b : a));
  const share = longest.durationSeconds / total;
  if (share < DOMINANT_SHARE) return null;
  return (
    `One subagent, ${longest.task || longest.agentId}, took ` +
    `${formatDuration(longest.durationSeconds)}, ${Math.round(share * 100)}% of all subagent time.`
  );
}

export function theException(session) {
  const leading = leadingRuns(session);
  if (!leading || leading.runs.length < CONCENTRATION_MIN_RUNS) return null;
  const dominant = dominantModelOf(leading.runs);
  if (!dominant) return null;
  const others = leading.runs.filter((a) => (a.model || 'unknown') !== dominant.model);
  if (others.length !== 1) return null;
  const noun = leading.role === 'unknown'
    ? 'run'
    : (Object.hasOwn(ROLE_NOUNS, leading.role) ? ROLE_NOUNS[leading.role] : leading.role).toLowerCase();
  return (
    `One ${noun} ran on ${others[0].model || 'an unrecorded model'} where the other ` +
    `${numberWord(dominant.count)} ran on ${dominant.model}.`
  );
}

export function outsideSubagents(session) {
  if (!everyRunTimed(session)) return null;
  const elapsed = elapsedSeconds(session);
  const busy = subagentSeconds(session);
  if (!elapsed || !busy) return null;
  // Summed duration above elapsed means they overlapped; the gap is meaningless.
  if (busy > elapsed) return null;
  const share = (elapsed - busy) / elapsed;
  if (share < OUTSIDE_SHARE) return null;
  return `${Math.round(share * 100)}% of elapsed time fell outside any subagent.`;
}

/** Every qualifying sentence, in a fixed order so reports stay comparable. */
export function insightsFor(session) {
  return [
    modelRoleConcentration(session),
    dominantSubagent(session),
    theException(session),
    outsideSubagents(session),
  ].filter(Boolean);
}

function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function numberWord(n) {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six'][n] || String(n);
}

function formatDuration(seconds) {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
}
