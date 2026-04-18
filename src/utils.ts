import * as path from 'path';

// Pure functions with no VS Code dependency — importable in tests without mocking vscode.

export interface SelectionLike {
    start: { line: number; character: number };
    end: { line: number; character: number };
}

export interface SymbolLike {
    name: string;
    range: { start: { line: number }; end: { line: number } };
    children: SymbolLike[];
}

export interface LineRange {
    startLine: number;
    endLine: number;
}

export interface GitRemoteLike {
    name?: string;
    fetchUrl?: string;
}

export type RefFormat = 'simple' | 'github' | 'markdown-link';

/** Return the inclusive 0-based end line for the visible selection. */
export function getSelectionEndLine(sel: SelectionLike): number {
    return (sel.end.character === 0 && sel.end.line > sel.start.line)
        ? sel.end.line - 1
        : sel.end.line;
}

/**
 * Convert a VS Code Selection (0-based) to 1-based display line numbers.
 * Handles the triple-click edge case where the selection anchor lands at
 * column 0 of the line after the last visually selected line.
 */
export function getLineRange(sel: SelectionLike): LineRange {
    const startLine = sel.start.line + 1;
    const endLine = getSelectionEndLine(sel) + 1;
    return { startLine, endLine };
}

/** Build the simple `file:line` or `file:start-end` reference string. */
export function buildSimpleRef(
    fileRef: string,
    startLine: number,
    endLine: number,
    symbol?: string
): string {
    const lineStr = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
    const symbolSuffix = symbol ? `::${symbol}` : '';
    return `${fileRef}:${lineStr}${symbolSuffix}`;
}

/**
 * Walk the symbol tree (depth-first) and return the innermost symbol whose
 * range contains `line` (0-based).
 */
export function findInnermostSymbol(symbols: SymbolLike[], line: number): SymbolLike | undefined {
    for (const sym of symbols) {
        if (sym.range.start.line <= line && line <= sym.range.end.line) {
            const child = findInnermostSymbol(sym.children, line);
            return child ?? sym;
        }
    }
    return undefined;
}

/** Remove duplicate strings, preserving the first occurrence. */
export function uniqueRefs(refs: string[]): string[] {
    return refs.filter((r, i) => refs.indexOf(r) === i);
}

/** Select the output shape for a copied reference. */
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

/** Move the copied entry to the front and trim history to the configured size. */
export function updateHistory(history: string[], entry: string, maxSize: number): string[] {
    return [entry, ...history.filter(existing => existing !== entry)].slice(0, maxSize);
}

/** Prefer the GitHub remote named `origin`, otherwise use the first GitHub remote. */
export function pickGitHubRemoteUrl(remotes: GitRemoteLike[]): string | undefined {
    const githubRemotes = remotes.filter(remote =>
        typeof remote.fetchUrl === 'string' && getGitHubRepoPath(remote.fetchUrl) !== null
    );
    return githubRemotes.find(remote => remote.name === 'origin')?.fetchUrl
        ?? githubRemotes[0]?.fetchUrl;
}

/** Pick the deepest repo root that contains `filePath`, if any. */
export function pickContainingRepoRoot(roots: string[], filePath: string, sep?: string): string | undefined {
    const pathApi = sep === '\\'
        ? path.win32
        : sep === '/'
            ? path.posix
            : roots.some(root => root.includes('\\')) || filePath.includes('\\')
                ? path.win32
                : path.posix;

    return roots
        .filter(root => {
            const relative = pathApi.relative(root, filePath);
            return relative === ''
                || (!relative.startsWith(`..${pathApi.sep}`) && relative !== '..' && !pathApi.isAbsolute(relative));
        })
        .sort((a, b) => b.length - a.length)[0];
}

/** Extract `owner/repo` from a GitHub SSH or HTTPS fetch URL. */
export function getGitHubRepoPath(remoteUrl: string): string | null {
    const match = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
    return match?.[1] ?? null;
}

/** Build a stable GitHub blob URL pinned to a commit SHA. */
export function buildGitHubBlobUrl(
    remoteUrl: string,
    commit: string,
    relativePath: string,
    startLine: number,
    endLine: number
): string | null {
    const repoPath = getGitHubRepoPath(remoteUrl);
    if (!repoPath) { return null; }

    const lineFragment = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
    return `https://github.com/${repoPath}/blob/${commit}/${relativePath}#${lineFragment}`;
}

/** Build a Git-repo-relative path and normalize separators for URLs. */
export function toRepoRelativePath(repoRoot: string, filePath: string): string {
    const pathApi = repoRoot.includes('\\') || filePath.includes('\\')
        ? path.win32
        : path.posix;
    return pathApi.relative(repoRoot, filePath).split(pathApi.sep).join('/');
}
