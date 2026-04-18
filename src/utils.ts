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

/** Move the copied entry to the front and trim history to the configured size. */
export function updateHistory(history: string[], entry: string, maxSize: number): string[] {
    return [entry, ...history.filter(existing => existing !== entry)].slice(0, maxSize);
}

/** Build a Git-repo-relative path and normalize separators for URLs. */
export function toRepoRelativePath(repoRoot: string, filePath: string): string {
    const pathApi = repoRoot.includes('\\') || filePath.includes('\\')
        ? path.win32
        : path.posix;
    return pathApi.relative(repoRoot, filePath).split(pathApi.sep).join('/');
}
