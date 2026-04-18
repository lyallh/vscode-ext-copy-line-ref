---
type: bug
created: 2026-04-18
priority: medium
severity: major
estimate: 30m
updated: 2026-04-18
tags: [github-url, format, includeSymbol, needs-testing]
related_files:
  - src/extension.ts:64-68
  - src/utils.ts:72-85
  - src/test/utils.test.ts:124-152
  - README.md:77-89
  - package.json:89-92
---

# Fix `github` Format Producing Invalid URL When `includeSymbol` Is On

## Description

`formatRef` appends `::<symbol>` directly onto the GitHub URL:

```ts
if (format === 'github') {
    const url = getGitHubUrl(document, startLine, endLine);
    return url ? `${url}${symbol ? `::${symbol}` : ''}` : simple;
}
```

`getGitHubUrl` already returns a URL ending in `#L<start>-L<end>`. Appending
`::handleLogin` yields:

```
https://github.com/org/repo/blob/main/src/auth/login.ts#L45-L52::handleLogin
```

GitHub's line-scrolling anchor only recognises `#L<n>` / `#L<n>-L<m>` — the
`::handleLogin` is absorbed into the URL fragment and the page no longer
scrolls to the selection. The link also fails the spirit of a permalink:
pasting it into any tool that validates/canonicalises URLs ends up with a
stray suffix that does not round-trip.

The `simple` format builds the symbol into the reference via
`buildSimpleRef`, which already appends `::symbol` correctly to a
`path:lines` string. Only the `github` path is broken.

## Objectives

- [ ] `format: github` with `includeSymbol: true` produces a URL that
      scrolls to the selected line range on github.com.
- [ ] Symbol information is not silently lost — it is surfaced somewhere
      sensible (or the behaviour is explicitly documented as "symbol is
      not shown in github format").
- [ ] README accurately describes the chosen behaviour.

## Context

Flagged during code review of PR #2, scored 75 (below the auto-comment
threshold). Affects every user who sets `copyLineRef.format = "github"` and
`copyLineRef.includeSymbol = true` simultaneously.

## Technical Design

Chosen approach: **Option A**.

### Option A — Drop the symbol from `github` output

Symbols are a simple-format concept. GitHub's URL already anchors on lines,
which is more precise than a symbol name. Just ignore `symbol` when
`format === 'github'`:

```ts
if (format === 'github') {
    return getGitHubUrl(document, startLine, endLine) ?? simple;
}
```

Update README to clarify that `includeSymbol` is a no-op for `github`
format, or document that the fallback to `simple` still includes the
symbol. Smallest diff, zero risk of producing invalid URLs.

The implementation now routes format selection through a pure helper:

```ts
export function formatCopiedRef(
    format: RefFormat,
    simpleRef: string,
    fileRef: string,
    githubUrl?: string | null
): string {
    if (format === 'github') {
        return githubUrl ?? simpleRef;
    }
    if (format === 'markdown-link') {
        return `[${simpleRef}](./${fileRef})`;
    }
    return simpleRef;
}
```

### Option B — Emit a markdown link with symbol as label

Change the `github` output to
`[src/auth/login.ts:45-52::handleLogin](https://github.com/...#L45-L52)`
when `includeSymbol` is on. This preserves the symbol information in paste
targets that render markdown (Slack, GitHub comments, LLM chats) without
corrupting the URL. Note: this overlaps with the existing `markdown-link`
format, which currently links to a relative path rather than a GitHub URL.

Option B remains a separate feature idea, not part of this bug fix.

### Components Affected

- `src/extension.ts` — `formatRef` github branch.
- `README.md` — `copyLineRef.includeSymbol` section, note interaction with
  `format: github`.
- `src/utils.ts` — extracted pure `formatCopiedRef()` helper.
- `src/test/utils.test.ts` — unit coverage for format-selection behavior.

### API Changes

None externally. Behavioural change: `::symbol` no longer appears when
`format === 'github'`.

### Data Model Changes

None.

### Configuration

No new settings. Consider documenting the interaction between
`copyLineRef.format` and `copyLineRef.includeSymbol`.

## Implementation

1. Route `formatRef` through a pure `formatCopiedRef()` helper in
   `src/utils.ts`.
2. Make the helper return the GitHub URL unchanged for `format === 'github'`
   and fall back to the simple reference when no GitHub URL is available.
3. Update `README.md` to note that `includeSymbol` applies to the `simple`
   and `markdown-link` formats only.
4. Update the setting description in `package.json` to state that
   `includeSymbol` is ignored for GitHub URLs.
5. Manual check in VS Code: set `format: github`, `includeSymbol: true`,
   copy a selection inside a function, paste into a browser, confirm the
   URL scrolls to the line range.

## Testing Strategy

- Unit tests: cover the format-selection logic for each combination of
  `format` × `includeSymbol`.
- Integration tests: none planned.
- Manual testing: verify github.com actually scrolls for the produced URL.

## Definition of Done

- [x] `formatRef` no longer appends `::symbol` to GitHub URLs.
- [x] README updated.
- [x] Unit test asserts URL shape.
- [x] `npm test` and `npm run typecheck` clean.
- [ ] Manual browser verification recorded in the PR description.

## Implementation Log

- Extracted pure format-selection logic into `formatCopiedRef()` in
  `src/utils.ts` so the `github` behavior is testable without the VS Code API.
- Updated `formatRef()` in `src/extension.ts` to build the simple reference,
  resolve a GitHub URL only when needed, and delegate the final output shape
  to `formatCopiedRef()`.
- Added unit tests covering:
  - `simple` output
  - `github` output with a valid GitHub URL
  - `github` fallback when no GitHub URL is available
  - `markdown-link` output
  - explicit assertion that `github` output does not contain `::`
- Updated README and the setting description to document that
  `includeSymbol` applies to `simple` and `markdown-link`, not `github`.
- Automated verification completed:
  - `npm test`
  - `npm run typecheck`

## Open Questions

- Should `markdown-link` format also be upgraded to use the GitHub URL
  when one is available? That's a separate feature but the two questions
  are related — solving this bug with Option A leaves the door open;
  Option B pre-empts the design.

## Notes

The format-selection logic has now been extracted into `formatCopiedRef()`,
which closes the main testability gap that allowed this regression.
