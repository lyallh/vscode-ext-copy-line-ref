import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand(
        'copyLineRef.copyReference',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const fileName = path.basename(editor.document.fileName);
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
