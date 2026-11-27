---
name: verify-qnote
description: Drive the QNote Electron desktop app the way a user does and prove the result with screenshots, DOM assertions, and isolated-database rows. Use when a QNote change needs end-to-end proof beyond unit tests, when verifying a feature in the notes/todo/clipboard/plugin surfaces, or when asked to verify or drive the real app.
---

# Verify QNote

QNote is an Electron desktop app: a React single-page app in the main window plus separate windows for the island, the sticky note, and the clipboard popup. This skill drives the real app over the Chrome DevTools Protocol and records what it did.

Everything below is grounded in the repo. The commands are real; the paths and handles are real.

## Launch

Prerequisite: the main process must be compiled, because the harness runs the compiled output, not the TypeScript.

```bash
pnpm run build:electron
node scripts/dev/verify/qnote-verify.js launch --port 9333
```

`launch` does all of this:

- copies the compiled `dist/` into `<repo>/.data/verify/<runId>/tree/app` (the folder is named `app`, not `dist`, on purpose, see Gotchas),
- copies `package.json` next to it and links `node_modules` and `resources` back to the repo,
- gives the instance its own `--user-data-dir` and therefore its own SQLite database at `<tree>/.data/clipboard.sqlite`, so the repo's `.data/clipboard.sqlite` is never touched,
- starts Electron with `QNOTE_REMOTE_DEBUG_PORT=<port>`, which turns on the CDP endpoint,
- starts the vite dev server on `localhost:5173` if it is not already running (the renderer is served from there; the compiled `dist/renderer` is not used in this mode),
- prints the session JSON: `runId`, `electronPid`, `appRoot`, `evidenceDir`, `appLog`.

The instance is ready when the main window has rendered. `doctor` is that check.

```bash
node scripts/dev/verify/qnote-verify.js doctor --port 9333
```

`doctor` reports the browser build, every CDP target, and the main window's `readyState`, whether `#root` has children, and the current hash. It exits non-zero when the instance is not worth driving. Run it first whenever anything looks wrong.

The instance opens a real QNote window on the desktop. Minimize it so it stays out of the way and stays alive:

```bash
node scripts/dev/verify/qnote-verify.js eval --expr "window.electron.minimizeWindow()"
```

## Drive

Every command is a short-lived process. Do not run them from a long-lived shell: the instance is a child of the first shell, and a shell that times out takes the instance down with it.

```bash
# Route changes go through the hash, the renderer uses HashRouter
node scripts/dev/verify/qnote-verify.js nav --route /todos

# Wait for something to appear before acting on it
node scripts/dev/verify/qnote-verify.js wait --expr "document.body.innerText.includes('新建 Todo')" --timeout 12000

# Real mouse click, located by aria-label / visible text / role / placeholder / CSS
node scripts/dev/verify/qnote-verify.js click --text "新建 Todo"
node scripts/dev/verify/qnote-verify.js click --aria "标记为已完成"
node scripts/dev/verify/qnote-verify.js click --right --selector "..."

# Real typing: focuses the field, then sends key events like a user
node scripts/dev/verify/qnote-verify.js fill --placeholder "输入 Todo 标题" --value "验证待办-9333"

# Real key press, modifiers combine
node scripts/dev/verify/qnote-verify.js press --key p --ctrl --shift

# Anything else: run JS in the page and read the value back
node scripts/dev/verify/qnote-verify.js eval --expr "({hash: location.hash, title: document.title})"
```

The CDP target list holds more than one page: the main window and the island window. The driver picks the target whose path is `/` (the main window). Pass `--target island` to drive the island instead.

## Evidence

Evidence for a run lives in `<repo>/.data/verify/<runId>/evidence`. That path is printed by `launch` and by `stop`.

- Screenshot: `node scripts/dev/verify/qnote-verify.js shot --out todo-list.png` writes into the evidence directory. A relative `--out` goes there; an absolute path is used as given.
- Stored state: `node scripts/dev/verify/qnote-verify.js db --sql "select id, title, completed from todo"` reads the instance's own SQLite file read-only, through `node:sqlite`. No extra dependency, and it never touches the repo database.
- Screen state: `eval` with an expression that returns a small object.

Proof standards:

- Drive the real user path. Real mouse and key events, real buttons. Never call an internal setter or a test-only endpoint and call that a pass.
- Capture the action and the resulting state, not only the final screen. A screenshot alone is not proof.
- Verify side effects in the database as well as on screen. A row that exists is stronger evidence than a label that changed.
- A run that cannot reach a precondition reports the failure and the unmet precondition. Never weaken a journey to make it pass, and never report a skipped entry point as verified through a different path.

## Cleanup

```bash
node scripts/dev/verify/qnote-verify.js stop --port 9333
```

`stop` kills the Electron process tree and the dev server if it started one, then prints `disposeTempRoot`. The harness never deletes files. Dispose of the isolated tree yourself with your platform's trash, and keep the evidence directory:

```bash
rm '<repo>/.data/verify/<runId>/tree'
```

Evidence must survive teardown. After `stop`, confirm the screenshots are still at the named path.

## Helpers

Two scripts, both dependency-free (Node's built-in `WebSocket`, `node:http`, `node:sqlite`; Node 22.5+ for `node:sqlite`):

- `scripts/dev/verify/qnote-verify.js` — the CLI. `node scripts/dev/verify/qnote-verify.js` with no arguments prints the full command list.
- `scripts/dev/verify/cdp.js` — the CDP client used by the CLI.

## Gotchas

- **The island window is a second CDP page target.** Drive the main window by default; `--target island` for the island.
- **Closing the main window quits the whole app.** The app quits on `window-all-closed`, and the close button hides to tray rather than closing. Minimize the window instead and leave it alone.
- **The app records the real system clipboard into the isolated database.** The clipboard watcher is always on, so the isolated database contains whatever the user copied. Never assert on clipboard row counts, and do not copy sensitive material into the machine while a run is going.
- **The app exits with a native crash after its graceful shutdown.** The shutdown handlers run, then a native module throws `napi_throw` and the process dies with a nonzero code. The instance is gone either way; this is not a failed verification.
- **Keep the compiled tree out of a folder named `dist` inside the repo.** `pnpm dev` runs `scripts/dev/kill-dev-electron.js`, which kills every `electron.exe` whose command line contains `dist/main/index.js` and the repo root. The harness copies `dist` to `tree/app`, so the marker does not match. Keep that rename if the layout ever changes.
- **The renderer must be reachable on `localhost:5173`, and vite listens on IPv6 `::1` only.** A probe against `127.0.0.1:5173` fails even though the server is up.
- **The isolated database path is derived by walking up from the compiled database module until it finds `package.json`.** That is why the harness copies `package.json` next to the tree: the database lands in `<tree>/.data` instead of the repo's `.data`.
- **The Rust native modules are looked up under `dist/native` and then one level up from the compiled loader.** The harness's `tree/app/native` copy is what the second candidate finds, so the native modules still load.

## Feature map

`.cursor/skills/verify-qnote/features/README.md` is the maintained map of what to verify and how. Read it before driving, then follow the matching feature file.
