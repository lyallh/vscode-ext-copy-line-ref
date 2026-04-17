import * as vscode from 'vscode';
import * as path from 'path';

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
    return {
        format: cfg.get<RefFormat>('format', 'simple'),
        includeSymbol: cfg.get<boolean>('includeSymbol', false),
        contextLines: cfg.get<number>('contextLines', 0),
    };
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
    const relative = vscode.workspace.asRelativePath(document.uri, false);
    const lineFragment = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
    return `https://github.com/${repoPath}/blob/${branch}/${relative}#${lineFragment}`;
}

function formatRef({ fileRef, startLine, endLine, document, symbol }: FormatContext): string {
    const { format } = getConfig();
    const lineStr = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
    const symbolSuffix = symbol ? `::${symbol}` : '';
    const simple = `${fileRef}:${lineStr}${symbolSuffix}`;

    if (format === 'github') {
        // Symbol suffix appended after the URL fragment for readability.
        const url = getGitHubUrl(document, startLine, endLine);
        return url ? `${url}${symbolSuffix}` : simple;
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

function getLineRange(sel: vscode.Selection): { startLine: number; endLine: number } {
    const startLine = sel.start.line + 1;
    // If selection ends at column 0 of a new line, that line wasn't
    // visually selected — treat the end as the previous line.
    const endLine = (sel.end.character === 0 && sel.end.line > sel.start.line)
        ? sel.end.line
        : sel.end.line + 1;
    return { startLine, endLine };
}

function getLanguageId(document: vscode.TextDocument): string {
    // Use VS Code's languageId directly — it matches common fenced-code-block identifiers.
    return document.languageId === 'plaintext' ? '' : document.languageId;
}

/** Deduplicate adjacent/overlapping selections that resolve to the same line range. */
function uniqueRefs(refs: string[]): string[] {
    return refs.filter((r, i) => refs.indexOf(r) === i);
}

/**
 * Walk the document symbol tree to find the innermost symbol whose range
 * contains the given (0-based) line.
 */
function findInnermostSymbol(
    symbols: vscode.DocumentSymbol[],
    line: number
): vscode.DocumentSymbol | undefined {
    for (const sym of symbols) {
        if (sym.range.start.line <= line && line <= sym.range.end.line) {
            const child = findInnermostSymbol(sym.children, line);
            return child ?? sym;
        }
    }
    return undefined;
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
    const updated = [text, ...history.filter(h => h !== text)].slice(0, HISTORY_MAX);
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

            // Support multi-cursor / multi-selection.
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

            // For multiple selections, emit one fenced block per selection.
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

                        // Expand the extracted range by contextLines on each side.
                        const ctxStart = Math.max(0, sel.start.line - contextLines);
                        const ctxEnd = Math.min(lineCount - 1, sel.end.line + contextLines);
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
            // Invoked from Explorer context menu (uri provided) or command palette (use active editor).
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

            // Show first line of each entry as the label; full content as detail.
            const items = history.map(entry => {
                const lines = entry.split('\n');
                return { label: lines[0], detail: lines.length > 1 ? `${lines.length} lines` : undefined, entry };
            });

            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a previous reference to copy again',
                matchOnDetail: true,
            });
            if (!picked) { return; }

            await vscode.env.clipboard.writeText(picked.entry);
            vscode.window.setStatusBarMessage(`Copied: ${picked.label}`, 3000);
        })
    );
}

export function deactivate(): void {
    statusBarItem?.dispose();
}
