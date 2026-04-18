---
type: bug
created: 2026-04-18
priority: medium
severity: minor
estimate: 30m
updated: 2026-04-18
tags: [github-url, git, path-matching, needs-testing]
related_files:
  - src/extension.ts:36-61
  - src/utils.ts:75-99
  - src/test/utils.test.ts
dependencies: []
blocks: []
---

# Fix `getGitHubUrl` Repo Match Against Prefix-Sharing Roots

## Description

`getGitHubUrl` picks the active repository by testing whether the document's
`fsPath` starts with a repo's `rootUri.fsPath`:

```ts
const repo = git.repositories.find((r: { rootUri: vscode.Uri }) =>
    document.uri.fsPath.startsWith(r.rootUri.fsPath)
);
```

Because `String.prototype.startsWith` is not path-segment aware, a repo root at
`/repos/foo` will match a document at `/repos/foobar/file.ts`. When two
repositories share a path prefix the wrong repo is selected, producing a
GitHub URL built against the wrong remote/branch and an incorrect relative
path. Because `toRepoRelativePath()` uses `path.relative()`, that incorrect
root can also produce `../...` segments in the generated URL path. The
resulting link silently points somewhere plausible but wrong — the user may
not notice until a reviewer clicks it.

`find` also returns the first match, so when a document sits inside a nested
repository and both the outer and inner repos are open, the outer repo may
be selected even though the inner repo is the correct owner.

## Objectives

- [ ] Repo selection chooses the deepest matching repo root, not the first
      one returned by the git extension API.
- [ ] Prefix match is path-segment aware (uses separator, not raw string
      prefix).
- [ ] If the helper is written generically, exact root equality still counts
      as contained.
- [ ] Cross-platform: works for both POSIX and Windows separators.

## Context

Flagged during code review of PR #2. Scored 75 (below the auto-comment
threshold) so not included in the PR comment, but still a latent correctness
bug worth fixing before multi-root / nested-repo usage becomes common.

## Technical Design

Replace the `startsWith` predicate with a `path.relative()` containment check
and pick the deepest root:

```ts
function containsPath(root: string, file: string): boolean {
    const rel = path.relative(root, file);
    return rel === ''
        || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

const repoRoot = roots
    .filter(root => containsPath(root, filePath))
    .sort((a, b) => b.length - a.length)[0];
```

This avoids raw string-prefix matching and still handles exact equality
(`relative === ''`). The helper should use the correct path flavor for the
input being checked so Windows tests can run predictably on POSIX.

Extract the predicate (and the deepest-match selection) into a pure helper
in `src/utils.ts` so it can be unit-tested without the `vscode` API.

Two implementation details to preserve:

- The helper should operate on path strings only so it stays testable without
  the VS Code git API.
- The extension does not need a second lookup by path if the helper can select
  the repo object directly after deriving the comparable root path for each
  candidate.

### Components Affected

- `src/extension.ts` — `getGitHubUrl` repo-match logic.
- `src/utils.ts` — new pure helper, e.g. `pickContainingRepoRoot(roots, file)`.
- `src/test/utils.test.ts` — tests for prefix-sibling and nested-root cases.

### API Changes

None externally. Add an internal utility in `utils.ts`.

### Data Model Changes

None.

### Configuration

None.

## Implementation

1. Add `pickContainingRepoRoot(roots: string[], file: string, sep?: string)`
   to `src/utils.ts`. Default `sep = path.sep`; Windows-path tests should pass
   `'\\'` explicitly when run on POSIX.
2. Update `getGitHubUrl` in `src/extension.ts` to map the git extension
   repositories to their `rootUri.fsPath`, call the helper, and use the
   deepest matching repo for remote/branch/path generation.
3. Add unit tests covering:
   - Prefix-sibling roots (`/repos/foo` vs `/repos/foobar/file.ts`).
   - Nested roots (outer `/a` and inner `/a/b` with a file at `/a/b/c.ts`).
   - Exact equality if the helper is intentionally generic.
   - Windows separators (`\\`).
4. Manual verification: open two workspace folders whose paths share a
   prefix, copy a reference from each, confirm each URL points at the
   correct remote and does not include `/../` in the blob path.

## Testing Strategy

- Unit tests: exhaustive coverage of the pure helper in `utils.test.ts`.
- Integration tests: none planned (would require a fake git extension).
- Manual testing: multi-root workspace with prefix-sibling folders and a
  nested submodule, verifying both produce correct GitHub URLs.

## Definition of Done

- [x] Pure helper added and exported from `src/utils.ts`.
- [x] `getGitHubUrl` uses the helper.
- [x] New unit tests pass (`npm test`).
- [x] `npm run typecheck` clean.
- [ ] Manual sanity check with two prefix-sibling workspace folders confirms
      no `../` segments appear in generated GitHub URLs.

## Implementation Log

- Added `pickContainingRepoRoot()` to `src/utils.ts`. It uses `path.relative()`
  plus explicit `..` segment checks, picks the deepest matching root, and
  supports both POSIX and Windows separators.
- Updated `getGitHubUrl()` in `src/extension.ts` to resolve the containing repo
  via `pickContainingRepoRoot()` instead of `startsWith()`.
- Added unit tests in `src/test/utils.test.ts` for:
  - no containing repo
  - prefix-sharing sibling repos
  - nested repos
  - exact root equality
  - valid dot-prefixed names like `..bar/file.ts`
  - Windows paths
- Verification completed:
  - `npm test`
  - `npm run typecheck`

## Open Questions

- Should the fix also handle case-insensitive paths (macOS default / Windows)?
  The git extension stores `fsPath` as VS Code saw it — case may already
  match, but users can mount case-insensitive volumes. Follow whatever the
  built-in git extension does (likely case-sensitive on Linux, insensitive
  elsewhere) rather than re-implementing.
- Is the deepest-match behaviour observably correct for git submodules, or
  does the VS Code git extension already surface submodules as distinct
  repositories with their own remotes?

## Notes

