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

export function activate(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand(
        'copyLineRef.copyReference',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const fileName = getFileRef(editor.document);
            const sel = editor.selection;
            const startLine = sel.start.line + 1;

            // If selection ends at column 0 of a new line, that line wasn't
            // visually selected — treat the end as the previous line.
            const endLine = (sel.end.character === 0 && sel.end.line > sel.start.line)
                ? sel.end.line
                : sel.end.line + 1;

            const reference = startLine === endLine
                ? `${fileName}:${startLine}`
                : `${fileName}:${startLine}-${endLine}`;

            await vscode.env.clipboard.writeText(reference);
            vscode.window.setStatusBarMessage(`Copied: ${reference}`, 3000);
        }
    );

    context.subscriptions.push(disposable);
}

export function deactivate(): void {}
