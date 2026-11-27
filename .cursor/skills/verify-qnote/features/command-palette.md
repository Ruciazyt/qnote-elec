# Open the command palette

The command palette gives one keyboard-driven place to find and run the commands that plugins contribute.

## Sub-features

- `palette-open` opens the palette from the keyboard.
- `palette-empty` shows an empty state when no plugin contributes a command.
- `palette-search` filters the command list by the typed query.

## How to get to it (user POV)

- Press `Ctrl+Shift+P` anywhere in the main window.

## Driving it with qnote-verify

Preconditions:

- The instance is healthy (`doctor` reports `ok: true`) and the window is minimized.
- No plugin contributes a command, so the palette opens empty.

- **Open the palette.** Press `Ctrl+Shift+P`. Run `node scripts/dev/verify/qnote-verify.js press --key p --ctrl --shift`. A dialog appears with the placeholder `输入命令名，回车执行` and the body text contains `命令面板`.
- **Confirm the empty state.** Run `node scripts/dev/verify/qnote-verify.js eval --expr "document.body.innerText.includes('还没有插件命令')"`. The result is `true` when no plugin contributes a command.
- **Proof.** Run `node scripts/dev/verify/qnote-verify.js shot --out command-palette.png`. The screenshot shows the palette over the app.

## Gotchas

- The shortcut is `Ctrl+Shift+P`. Modifier flags in `press` combine, so `--ctrl --shift` is the whole chord and not two separate presses.
- The palette is rendered with an `sr-only` title, so the title is not visible in a screenshot. Assert on the body text instead.
- The palette is a modal. A click on the page behind it does not reach the page behind it, so close it before driving another part of the app.
