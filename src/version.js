/**
 * Single source of truth for the version.
 *
 * Kept as a literal rather than read from package.json so the library works
 * when imported from a bundle or a path where package.json is not adjacent.
 * `npm run sync-version` checks the two agree, and CI fails the release if not.
 */
export const VERSION = '0.2.2';
