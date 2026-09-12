# Releasing

How a change gets from `main` to someone's installed copy.

There are two distribution channels and they behave differently. The plugin is
served from this repository's own marketplace manifest on the default branch.
The npm package is served from a published tag.

## The rule that matters

**A plugin fix does not reach anyone until the version changes.**

Claude Code caches an installed plugin under its version:

```
~/.claude/plugins/cache/agent-observer-marketplace/agent-observer/0.1.1/
```

`/plugin marketplace update` compares the version in the marketplace manifest
against what is already on disk. Same number, nothing to fetch. A fix pushed to
`main` without a bump leaves every installed copy on the old build, and the
update command reports success while changing nothing.

This has already happened once in this project. Bump the version for anything a
user would notice, including a change to `SKILL.md`.

## Cutting a release

1. **Make sure `main` is green.** The release job re-runs the checks, but find
   out before tagging, not after.

2. **Set the version everywhere.** Five files declare it, and they must agree:

   ```bash
   node scripts/sync-version.mjs 0.2.0
   ```

   That writes `package.json`, `.claude-plugin/plugin.json`, both version
   fields in `.claude-plugin/marketplace.json`, and `src/version.js`.

3. **Write the changelog entry.** Move what is under `Unreleased` into a new
   `## [0.2.0] - YYYY-MM-DD` heading and add the link references at the bottom.
   `scripts/check-version.mjs` requires the newest heading to match the version,
   and the GitHub release body is extracted from this section.

4. **Verify.**

   ```bash
   pnpm run verify
   ```

5. **Commit and tag.** The tag is the trigger, and it must match:

   ```bash
   git commit -am "Release v0.2.0"
   git tag -a v0.2.0 -m "Release v0.2.0"
   git push --follow-tags
   ```

   **`-a` is not optional.** `git push --follow-tags` pushes annotated tags and
   silently ignores lightweight ones, so `git tag v0.2.0` without it leaves the
   tag on your machine, the release workflow never fires, and the push reports
   success. Check with `git ls-remote --tags origin` if no release run appears.

## What happens then

The release workflow runs on the tag:

- **verify** runs the full check on Linux and Windows, with `RELEASE_TAG` set so
  `check-version` also compares the tag against the manifests. A mismatch stops
  the release here.
- **publish-npm** publishes with provenance. Without an `NPM_TOKEN` repository
  secret it skips itself and says so rather than failing the run.
- **github-release** packs a tarball and creates the release, using the
  changelog section for that version as the body.
- **marketplace** checks that `main` declares the version that was tagged. This
  is the one that catches tagging from a branch whose version bump never
  reached `main`, which would publish one version while `/plugin install` serves
  another.

## Plugin users

The plugin does not update itself. Tell people to run:

```
/plugin marketplace update agent-observer-marketplace
/reload-plugins
```

The second step matters. The first fetches the new version, and without a reload
the running session keeps the skill text and the bundled script it already
loaded. A user who skips it sees the old behaviour and reasonably concludes the
update failed.

To confirm which version is actually loaded:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/agent-observer.js" --version
```

Or look at the path: the version is a directory component in
`~/.claude/plugins/cache/agent-observer-marketplace/agent-observer/`. More than
one directory there means older versions are still cached, which is normal.

## Registry users

```bash
npm update -g agent-observer
pnpm update -g agent-observer
```

This needs a published tag. Pushing to `main` does nothing for them. The
project is developed with pnpm, but it publishes to the npm registry, so people
install it with whichever client they already use.

## Choosing the number

Semantic versioning, against the two interfaces people build on.

**Patch** for a bug fix that changes no interface. Most releases.

**Minor** for a new command, a new flag, a new adapter, or a new field in the
common event format. Adding a field is a minor: readers must ignore what they do
not recognise, so nothing breaks.

**Major** for anything that breaks a caller. Removing or repurposing a field in
[the common event format](event-format.md), removing a command or flag, changing
what an existing output format emits, or raising the minimum Node version.
Treat the event format as the most sensitive of these, because other tools parse
it and will not be watching this changelog.

## Fixing a bad release

Do not delete or move a tag that has been pushed. Anyone who fetched it keeps
the old commit, and npm refuses to republish a version at all.

Release forward instead. Fix, bump the patch, tag again. The broken version stays
in the history, and the changelog is where you say what was wrong with it.
