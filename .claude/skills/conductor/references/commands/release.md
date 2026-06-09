# Conductor Release

Cut a local release — changelog + version tag across shipped/archived tracks.

Generates a `CHANGELOG.md` entry and an annotated git tag covering tracks completed
since the last release. Like every Conductor git step, this is **local only** — it
never pushes a tag or branch. The user decides when to push (`git push --tags`).

## 1. Verify Setup

If `conductor/tracks.md` doesn't exist, tell the user to run `/conductor-setup` first.

## 2. Determine the Range

1. Find the last release tag: `git describe --tags --abbrev=0 2>/dev/null`.
2. The release covers tracks completed since that tag — primarily **archived** tracks
   (`conductor/archive/*/`) plus any `[x]` tracks not yet archived. Read each track's
   `metadata.json` (type, description) and `plan.md` task commit SHAs.
3. If there is no prior tag, cover all history up to `HEAD`.

## 3. Determine the Version

- Explicit version in args (e.g. `1.4.0`) → use it.
- `major`/`minor`/`patch` → bump the last tag accordingly (semver).
- Omitted → suggest a bump from change types (breaking→major, feat→minor, else patch)
  and confirm. Default scheme is semver; honor existing tag style if present.

## 4. Build the Changelog Entry

Group commits in range by Conventional-Commit type:
```bash
git log <last_tag>..HEAD --no-merges --pretty=format:'%h %s'
```
Produce `### Features` / `### Fixes` / `### Other` sections, each line
`<scope>: <description> (<track_id>, <short_sha>)`. Pull richer descriptions from track
specs where subjects are terse.

## 5. Write CHANGELOG.md

Prepend the new entry under the top `# Changelog` heading (create the file with a
"Keep a Changelog"-style header if absent). Show the rendered entry and confirm.

## 6. Commit + Tag (local only)

```bash
git add CHANGELOG.md
git commit -m "chore(release): <version>"
git tag -a <version> -m "Release <version>"
```
**Do not push.** Tell the user to push when ready:
`git push && git push origin <version>`.

## 7. Beads Sync (optional)

1. Run `which bd`; if not found, skip.
2. `bd note <project_or_epic> "RELEASE <version> <date>: <n> tracks, <n> commits."`
   - If a `bd` command fails, offer to continue / retry / stop.
