import * as vscode from 'vscode';
import * as path from 'path';

function getFileRef(document: vscode.TextDocument): string {
    // Prefer workspace-relative path; fall back to basename for unsaved/out-of-workspace files.
    const relative = vscode.workspace.asRelativePath(document.uri, false);
    // asRelativePath returns the absolute path unchanged when the file is outside the workspace.
    return relative === document.uri.fsPath
        ? path.basename(document.fileName)
        : relative;
}

function getLineRange(sel: vscode.Selection): { startLine: number; endLine: number } {
    const startLine = sel.start.line + 1;
    // If selection ends at column 0 of a new line, that line wasn't
    // visually selected — treat the end as the previous line.
    const endLine = (sel.end.character === 0 && sel.end.line > sel.start.line)
        ? sel.end.line
        : sel.end.line + 1;
    return { startLine, endLine };
}

function buildRef(fileRef: string, startLine: number, endLine: number): string {
    return startLine === endLine
        ? `${fileRef}:${startLine}`
        : `${fileRef}:${startLine}-${endLine}`;
}

function getLanguageId(document: vscode.TextDocument): string {
    // Use VS Code's languageId directly — it matches common fenced-code-block identifiers.
    return document.languageId === 'plaintext' ? '' : document.languageId;
}

/** Deduplicate adjacent/overlapping selections that resolve to the same line range. */
function uniqueRefs(refs: string[]): string[] {
    return refs.filter((r, i) => refs.indexOf(r) === i);
}

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('copyLineRef.copyReference', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }

            const fileRef = getFileRef(editor.document);

            // Support multi-cursor / multi-selection.
            const refs = uniqueRefs(
                editor.selections.map(sel => {
                    const { startLine, endLine } = getLineRange(sel);
                    return buildRef(fileRef, startLine, endLine);
                })
            );
            const reference = refs.join(', ');

            await vscode.env.clipboard.writeText(reference);
            vscode.window.setStatusBarMessage(`Copied: ${reference}`, 3000);
        }),

        vscode.commands.registerCommand('copyLineRef.copyReferenceWithCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }

            const fileRef = getFileRef(editor.document);
            const lang = getLanguageId(editor.document);

            // For multiple selections, emit one fenced block per selection.
            const seen = new Set<string>();
            const blocks = editor.selections
                .map(sel => {
                    const { startLine, endLine } = getLineRange(sel);
                    const ref = buildRef(fileRef, startLine, endLine);
                    if (seen.has(ref)) { return null; }
                    seen.add(ref);
                    const code = editor.document.getText(
                        new vscode.Range(sel.start.line, 0, sel.end.line, sel.end.character)
                    );
                    return `${ref}\n\`\`\`${lang}\n${code}\n\`\`\``;
                })
                .filter((b): b is string => b !== null);

            const output = blocks.join('\n\n');
            const summary = blocks.length === 1
                ? blocks[0].split('\n')[0]
                : `${blocks.length} selections from ${fileRef}`;

            await vscode.env.clipboard.writeText(output);
            vscode.window.setStatusBarMessage(`Copied: ${summary}`, 3000);
        })
    );
}

export function deactivate(): void {}
