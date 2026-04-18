# Copy Line Reference

Copy a precise code location reference to the clipboard for pasting into LLMs, issue trackers, or documentation.

```
src/auth/login.ts:45-62::handleLogin
```

---

## Commands

| Command | Shortcut (Win/Linux) | Shortcut (Mac) | Also available |
|---|---|---|---|
| **Copy Line Reference** | `Ctrl+Alt+C` | `Cmd+Alt+C` | Right-click menu |
| **Copy Line Reference with Code** | `Ctrl+Alt+Shift+C` | `Cmd+Alt+Shift+C` | Right-click menu |
| **Show Copy History** | `Ctrl+Alt+H` | `Cmd+Alt+H` | Command palette |
| **Copy File Reference** | — | — | Explorer right-click |
| **Re-copy Last Reference** | — | — | Click status bar / command palette |

---

## Basic usage

**Select nothing (cursor on a line):**
```
src/utils/parser.ts:42
```

**Select multiple lines:**
```
src/utils/parser.ts:42-58
```

**Multiple cursors/selections** are joined with `, `:
```
src/utils/parser.ts:42, src/utils/parser.ts:87-93
```

---

## Copy with code block

`Ctrl+Alt+Shift+C` copies the reference followed by a fenced markdown code block — ready to paste directly into a chat:

````
src/auth/login.ts:45-52
```typescript
export async function handleLogin(req: Request): Promise<Response> {
    const { email, password } = req.body;
    const user = await db.users.findByEmail(email);
    ...
}
```
````

Multiple selections produce multiple blocks separated by a blank line.

---

## Settings

Open **Settings** (`Ctrl+,`) and search for `copyLineRef`, or add to `settings.json`:

### `copyLineRef.format`

Controls the shape of the copied reference.

| Value | Example output |
|---|---|
| `simple` *(default)* | `src/auth/login.ts:45-52` |
| `github` | `https://github.com/org/repo/blob/main/src/auth/login.ts#L45-L52` |
| `markdown-link` | `[src/auth/login.ts:45-52](./src/auth/login.ts)` |

`github` resolves the remote URL and current branch via the built-in Git extension. Falls back to `simple` when the file is not inside a GitHub-hosted repository.

### `copyLineRef.includeSymbol`

When `true`, the enclosing function or class name is appended:

```
src/auth/login.ts:45::handleLogin
src/models/user.ts:12-30::UserService
```

Works with any language that has a VS Code symbol provider (TypeScript, Python, Go, Rust, Java, …). Default: `false`.

### `copyLineRef.contextLines`

Number of extra lines to include **above and below** the selection in the code block produced by *Copy Line Reference with Code*. The reference line numbers always reflect the exact selection. Default: `0`.

Example with `"copyLineRef.contextLines": 3` and lines 10–12 selected:

````
src/server.ts:10-12
```typescript
// lines 7–15 are in the block; reference still shows :10-12
````

---

## History

Every copy is recorded (up to 50 entries). Use `Show Copy History` command to open a Quick Pick of previous references and re-copy any of them. The status bar item shown after each copy is also clickable and re-copies the most recent entry.

---

## Workflow example

Typical session with an LLM agent:

1. Find the relevant code in your editor.
2. Select lines 45–62, press `Ctrl+Alt+Shift+C`.
3. Paste into the LLM chat — the reference and code arrive together.
4. The agent suggests a fix referencing `src/auth/login.ts:50`. Use `Ctrl+Alt+H` to re-paste other related snippets without leaving the chat.

---

## Building from source

```bash
npm install
npm run build       # produces dist/extension.js
npm run typecheck   # type-check only, no output
npm test            # run unit tests
npm run package     # produce .vsix for local install
```

Install a local build:
```bash
code --install-extension copy-line-ref-0.0.1.vsix
```
