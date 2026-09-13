/**
 * Model id normalisation shared by every adapter that reads a Claude model id
 * (Claude Code directly, OpenCode when it dispatches through the Claude
 * provider).
 */

/**
 * Trim a model id down to its family when it is a full API id, so that
 * `claude-haiku-4-5-20251001` and a bare `haiku` group together in reports.
 * `inherit` is left as-is because it is a real, distinct answer.
 */
export function normaliseModel(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const lowered = text.toLowerCase();
  for (const family of ['haiku', 'sonnet', 'opus', 'fable']) {
    if (lowered.includes(family)) return family;
  }
  return text;
}
