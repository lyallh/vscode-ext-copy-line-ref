import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    getLineRange,
    buildSimpleRef,
    findInnermostSymbol,
    uniqueRefs,
    toRepoRelativePath,
    type SelectionLike,
    type SymbolLike,
} from '../utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sel(
    startLine: number, startChar: number,
    endLine: number,   endChar: number
): SelectionLike {
    return { start: { line: startLine, character: startChar }, end: { line: endLine, character: endChar } };
}

function sym(name: string, startLine: number, endLine: number, children: SymbolLike[] = []): SymbolLike {
    return { name, range: { start: { line: startLine }, end: { line: endLine } }, children };
}

// ---------------------------------------------------------------------------
// getLineRange
// ---------------------------------------------------------------------------

describe('getLineRange', () => {
    test('cursor with no selection returns current line (1-based)', () => {
        const r = getLineRange(sel(9, 5, 9, 5));
        assert.deepEqual(r, { startLine: 10, endLine: 10 });
    });

    test('single-line selection', () => {
        const r = getLineRange(sel(9, 0, 9, 30));
        assert.deepEqual(r, { startLine: 10, endLine: 10 });
    });

    test('multi-line selection', () => {
        const r = getLineRange(sel(9, 0, 20, 15));
        assert.deepEqual(r, { startLine: 10, endLine: 21 });
    });

    test('triple-click edge case: selection ends at col 0 of the line after last selected', () => {
        // Selecting lines 9-20 by triple-clicking often places end at {line:21, char:0}.
        // Line 21 (0-based) was NOT visually selected, so endLine should be 21 (1-based line 21).
        const r = getLineRange(sel(9, 0, 21, 0));
        assert.deepEqual(r, { startLine: 10, endLine: 21 });
    });

    test('col-0 edge case only fires when end line > start line', () => {
        // Cursor at column 0, same line — must not subtract 1.
        const r = getLineRange(sel(4, 0, 4, 0));
        assert.deepEqual(r, { startLine: 5, endLine: 5 });
    });

    test('first line of file (0-based line 0)', () => {
        const r = getLineRange(sel(0, 0, 0, 0));
        assert.deepEqual(r, { startLine: 1, endLine: 1 });
    });
});

// ---------------------------------------------------------------------------
// buildSimpleRef
// ---------------------------------------------------------------------------

describe('buildSimpleRef', () => {
    test('single line', () => {
        assert.equal(buildSimpleRef('src/foo.ts', 10, 10), 'src/foo.ts:10');
    });

    test('multi-line range', () => {
        assert.equal(buildSimpleRef('src/foo.ts', 10, 21), 'src/foo.ts:10-21');
    });

    test('with symbol appended', () => {
        assert.equal(buildSimpleRef('src/foo.ts', 45, 45, 'handleLogin'), 'src/foo.ts:45::handleLogin');
    });

    test('multi-line with symbol', () => {
        assert.equal(buildSimpleRef('src/foo.ts', 10, 21, 'AuthService'), 'src/foo.ts:10-21::AuthService');
    });

    test('symbol undefined leaves no suffix', () => {
        assert.equal(buildSimpleRef('src/foo.ts', 5, 5, undefined), 'src/foo.ts:5');
    });

    test('workspace-relative path is preserved verbatim', () => {
        assert.equal(buildSimpleRef('src/auth/login.ts', 1, 1), 'src/auth/login.ts:1');
    });
});

// ---------------------------------------------------------------------------
// findInnermostSymbol
// ---------------------------------------------------------------------------

describe('findInnermostSymbol', () => {
    test('empty symbol list returns undefined', () => {
        assert.equal(findInnermostSymbol([], 5), undefined);
    });

    test('line outside all symbols returns undefined', () => {
        const symbols = [sym('foo', 0, 5), sym('bar', 10, 20)];
        assert.equal(findInnermostSymbol(symbols, 7), undefined);
    });

    test('line inside a top-level symbol with no children', () => {
        const symbols = [sym('foo', 0, 10)];
        assert.equal(findInnermostSymbol(symbols, 5)?.name, 'foo');
    });

    test('line inside a nested child returns the child, not the parent', () => {
        const child = sym('inner', 3, 7);
        const parent = sym('outer', 0, 10, [child]);
        assert.equal(findInnermostSymbol([parent], 5)?.name, 'inner');
    });

    test('line inside parent but outside child returns parent', () => {
        const child = sym('inner', 3, 7);
        const parent = sym('outer', 0, 10, [child]);
        assert.equal(findInnermostSymbol([parent], 9)?.name, 'outer');
    });

    test('line on the start boundary of a symbol', () => {
        const symbols = [sym('foo', 5, 15)];
        assert.equal(findInnermostSymbol(symbols, 5)?.name, 'foo');
    });

    test('line on the end boundary of a symbol', () => {
        const symbols = [sym('foo', 5, 15)];
        assert.equal(findInnermostSymbol(symbols, 15)?.name, 'foo');
    });

    test('deeply nested: returns the innermost', () => {
        const grandchild = sym('gc', 4, 5);
        const child = sym('c', 2, 7, [grandchild]);
        const parent = sym('p', 0, 10, [child]);
        assert.equal(findInnermostSymbol([parent], 4)?.name, 'gc');
    });

    test('picks the correct symbol among siblings', () => {
        const symbols = [sym('alpha', 0, 5), sym('beta', 6, 10)];
        assert.equal(findInnermostSymbol(symbols, 8)?.name, 'beta');
    });
});

// ---------------------------------------------------------------------------
// uniqueRefs
// ---------------------------------------------------------------------------

describe('uniqueRefs', () => {
    test('no duplicates returns same contents in order', () => {
        const refs = ['a:1', 'b:2', 'c:3'];
        assert.deepEqual(uniqueRefs(refs), refs);
    });

    test('adjacent duplicates: keeps first', () => {
        assert.deepEqual(uniqueRefs(['a:1', 'a:1', 'b:2']), ['a:1', 'b:2']);
    });

    test('non-adjacent duplicates: keeps first occurrence', () => {
        assert.deepEqual(uniqueRefs(['a:1', 'b:2', 'a:1']), ['a:1', 'b:2']);
    });

    test('all duplicates: returns single entry', () => {
        assert.deepEqual(uniqueRefs(['x:5', 'x:5', 'x:5']), ['x:5']);
    });

    test('empty array returns empty array', () => {
        assert.deepEqual(uniqueRefs([]), []);
    });

    test('single entry returns single entry', () => {
        assert.deepEqual(uniqueRefs(['src/main.ts:1']), ['src/main.ts:1']);
    });
});

// ---------------------------------------------------------------------------
// toRepoRelativePath
// ---------------------------------------------------------------------------

describe('toRepoRelativePath', () => {
    test('drops parent workspace segments before the git root', () => {
        assert.equal(
            toRepoRelativePath('/workspace/subrepo', '/workspace/subrepo/src/extension.ts'),
            'src/extension.ts'
        );
    });

    test('normalizes Windows separators for GitHub URLs', () => {
        assert.equal(
            toRepoRelativePath('C:\\workspace\\subrepo', 'C:\\workspace\\subrepo\\src\\extension.ts'),
            'src/extension.ts'
        );
    });
});
