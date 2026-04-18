import * as vscode from 'vscode';
import * as path from 'path';
import {
    getLineRange,
    buildSimpleRef,
    findInnermostSymbol,
    uniqueRefs,
    toRepoRelativePath,
    getSelectionEndLine,
    updateHistory,
} from './utils';

type RefFormat = 'simple' | 'github' | 'markdown-link';

interface FormatContext {
    fileRef: string;
    startLine: number;
    endLine: number;
    document: vscode.TextDocument;
    symbol?: string;
}

function getConfig(): { format: RefFormat; includeSymbol: boolean; contextLines: number } {
    const cfg = vscode.workspace.getConfiguration('copyLineRef');
    const rawContextLines = cfg.get<number>('contextLines', 0);
    return {
        format: cfg.get<RefFormat>('format', 'simple'),
        includeSymbol: cfg.get<boolean>('includeSymbol', false),
        contextLines: Number.isFinite(rawContextLines)
            ? Math.max(0, Math.floor(rawContextLines))
            : 0,
    };
}
}

function getGitHubUrl(document: vscode.TextDocument, startLine: number, endLine: number): string | null {
    // Resolve the remote URL and branch from workspace git extension API if available.
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt?.isActive) { return null; }
    const git = gitExt.exports.getAPI(1);
    const repo = git.repositories.find((r: { rootUri: vscode.Uri }) =>
        document.uri.fsPath.startsWith(r.rootUri.fsPath)
    );
    if (!repo) { return null; }

    const remoteUrl: string | undefined = repo.state.remotes[0]?.fetchUrl;
    const branch: string = repo.state.HEAD?.name ?? 'HEAD';
    if (!remoteUrl) { return null; }

    // Normalise SSH and HTTPS remote URLs to a https://github.com/... base.
    const match = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (!match) { return null; }

    const repoPath = match[1];
    const relative = toRepoRelativePath(repo.rootUri.fsPath, document.uri.fsPath);
    const lineFragment = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
    return `https://github.com/${repoPath}/blob/${branch}/${relative}#${lineFragment}`;
}

function formatRef({ fileRef, startLine, endLine, document, symbol }: FormatContext): string {
    const { format } = getConfig();
    const simple = buildSimpleRef(fileRef, startLine, endLine, symbol);

    if (format === 'github') {
        const url = getGitHubUrl(document, startLine, endLine);
        return url ? `${url}${symbol ? `::${symbol}` : ''}` : simple;
    }
    if (format === 'markdown-link') {
        return `[${simple}](./${fileRef})`;
    }
    return simple;
}

function getFileRef(document: vscode.TextDocument): string {
    // Prefer workspace-relative path; fall back to basename for unsaved/out-of-workspace files.
    const relative = vscode.workspace.asRelativePath(document.uri, false);
    // asRelativePath returns the absolute path unchanged when the file is outside the workspace.
    return relative === document.uri.fsPath
        ? path.basename(document.fileName)
        : relative;
}

function getLanguageId(document: vscode.TextDocument): string {
    // Use VS Code's languageId directly — it matches common fenced-code-block identifiers.
    return document.languageId === 'plaintext' ? '' : document.languageId;
}

async function resolveSymbol(document: vscode.TextDocument, line: number): Promise<string | undefined> {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        document.uri
    );
    if (!symbols?.length) { return undefined; }
    return findInnermostSymbol(symbols, line)?.name;
}

const HISTORY_MAX = 50;

let statusBarItem: vscode.StatusBarItem | undefined;

function getStatusBar(): vscode.StatusBarItem {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusBarItem.command = 'copyLineRef.recopyLast';
        statusBarItem.tooltip = 'Click to copy again';
    }
    return statusBarItem;
}

function showStatusBar(label: string): void {
    const bar = getStatusBar();
    bar.text = `$(clippy) ${label}`;
    bar.show();
    // Auto-hide after 8s (longer than before since it's now interactive).
    setTimeout(() => bar.hide(), 8000);
}

async function writeToClipboardWithHistory(
    text: string,
    label: string,
    historyStore: vscode.Memento
): Promise<void> {
    await vscode.env.clipboard.writeText(text);
    showStatusBar(`Copied: ${label}`);

    const history: string[] = historyStore.get<string[]>('history', []);
    const updated = updateHistory(history, text, HISTORY_MAX);
    await historyStore.update('history', updated);
}

export function activate(context: vscode.ExtensionContext): void {
    const store = context.globalState;

    context.subscriptions.push(
        vscode.commands.registerCommand('copyLineRef.copyReference', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }

            const fileRef = getFileRef(editor.document);
            const { includeSymbol } = getConfig();

            const refs = uniqueRefs(
                await Promise.all(
                    editor.selections.map(async sel => {
                        const { startLine, endLine } = getLineRange(sel);
                        const symbol = includeSymbol
                            ? await resolveSymbol(editor.document, sel.start.line)
                            : undefined;
                        return formatRef({ fileRef, startLine, endLine, document: editor.document, symbol });
                    })
                )
            );
            const reference = refs.join(', ');
            await writeToClipboardWithHistory(reference, reference, store);
        }),

        vscode.commands.registerCommand('copyLineRef.copyReferenceWithCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }

            const fileRef = getFileRef(editor.document);
            const lang = getLanguageId(editor.document);
            const { includeSymbol, contextLines } = getConfig();
            const lineCount = editor.document.lineCount;

            const seen = new Set<string>();
            const blocks = (
                await Promise.all(
                    editor.selections.map(async sel => {
                        const { startLine, endLine } = getLineRange(sel);
                        const symbol = includeSymbol
                            ? await resolveSymbol(editor.document, sel.start.line)
                            : undefined;
                        const ref = formatRef({ fileRef, startLine, endLine, document: editor.document, symbol });
                        if (seen.has(ref)) { return null; }
                        seen.add(ref);

                        const ctxStart = Math.max(0, sel.start.line - contextLines);
                        const selectionEndLine = getSelectionEndLine(sel);
                        const ctxEnd = Math.min(lineCount - 1, selectionEndLine + contextLines);
                        const code = editor.document.getText(
                            new vscode.Range(ctxStart, 0, ctxEnd, editor.document.lineAt(ctxEnd).text.length)
                        );
                        return `${ref}\n\`\`\`${lang}\n${code}\n\`\`\``;
                    })
                )
            ).filter((b): b is string => b !== null);

            const output = blocks.join('\n\n');
            const summary = blocks.length === 1
                ? blocks[0].split('\n')[0]
                : `${blocks.length} selections from ${fileRef}`;

            await writeToClipboardWithHistory(output, summary, store);
        }),

        vscode.commands.registerCommand('copyLineRef.recopyLast', async () => {
            const history = store.get<string[]>('history', []);
            if (!history.length) { return; }
            await vscode.env.clipboard.writeText(history[0]);
            showStatusBar(`Re-copied: ${history[0].split('\n')[0]}`);
        }),

        vscode.commands.registerCommand('copyLineRef.copyFileReference', async (uri?: vscode.Uri) => {
            const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (!targetUri) { return; }

            const relative = vscode.workspace.asRelativePath(targetUri, false);
            const fileRef = relative === targetUri.fsPath
                ? path.basename(targetUri.fsPath)
                : relative;

            await writeToClipboardWithHistory(fileRef, fileRef, store);
        }),

        vscode.commands.registerCommand('copyLineRef.showHistory', async () => {
            const history = store.get<string[]>('history', []);
            if (!history.length) {
                vscode.window.showInformationMessage('No copy-line-ref history yet.');
                return;
            }

            const items = history.map(entry => {
                const lines = entry.split('\n');
                return { label: lines[0], detail: lines.length > 1 ? `${lines.length} lines` : undefined, entry };
            });

            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a previous reference to copy again',
                matchOnDetail: true,
            });
            if (!picked) { return; }

            await writeToClipboardWithHistory(picked.entry, picked.label, store);
        })
    );
}

export function deactivate(): void {
    statusBarItem?.dispose();
}
