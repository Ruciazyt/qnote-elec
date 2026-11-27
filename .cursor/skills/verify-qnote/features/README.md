# QNote verification map

This directory is the maintained source for verifying the user-facing behavior of QNote. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Compile the main process: `pnpm run build:electron`.
- Start an isolated instance: `node scripts/dev/verify/qnote-verify.js launch --port 9333`.
- Require `node scripts/dev/verify/qnote-verify.js doctor --port 9333` to report `ok: true`.
- Minimize the window so it stays alive and out of the way: `node scripts/dev/verify/qnote-verify.js eval --expr "window.electron.minimizeWindow()"`.
- The renderer is served by vite on `localhost:5173`; the harness starts it when it is not already running.
- The instance has its own database under `.data/verify/<runId>/tree/.data/clipboard.sqlite`. The repo's `.data/clipboard.sqlite` is never written.
- Never drive an instance that this run did not start.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- The main window is the default CDP target. Use `--target island` only for the island window.
- Run each driver command as its own short-lived process. A shell that outlives the command can take the instance down with it.
- Prefer aria-labels and visible text over CSS selectors or DOM position.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Verify side effects in the instance's own database with `qnote-verify.js db --sql`, read-only.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the action and the resulting state, not only the final screen.
- UI proof includes a DOM assertion and a screenshot with the app identity visible.
- Mutation proof includes a read-only second view of the stored row.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with qnote-verify` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Manage a todo](./todo.md) covers creating, completing, archiving, and deleting a todo through the UI, with the stored row as proof.
- [Open the command palette](./command-palette.md) covers the keyboard entry point, the empty state, and searching for a command.
- [Create a note](./notes.md) covers creating a note file from the tree context menu and confirms it on disk.
- [Read the clipboard history](./clipboard.md) covers the recorded history, the search box, and deleting a record.
