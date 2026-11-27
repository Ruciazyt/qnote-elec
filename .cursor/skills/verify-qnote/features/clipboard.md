# Read the clipboard history

The home page keeps the system clipboard history and lets a user search it, copy a record back to the clipboard, and delete records.

## Sub-features

- `clipboard-record` stores a new system clipboard entry.
- `clipboard-list` shows the history on the home page.
- `clipboard-search` filters the history by the typed query.
- `clipboard-copy` writes a record back to the system clipboard.
- `clipboard-delete` removes a record.

## How to get to it (user POV)

- Choose `主页` in the left navigation.
- Type into the search box above the history list.
- Choose `复制内容` on a record to put it back on the clipboard.
- Choose `删除记录` on a record to remove it.

## Driving it with qnote-verify

Preconditions:

- The instance is healthy (`doctor` reports `ok: true`) and the window is minimized.
- The system clipboard holds a known marker string, for example `QNOTE-VERIFY-9333`.

- **Put a marker on the clipboard.** Run `Set-Clipboard -Value "QNOTE-VERIFY-9333"` in PowerShell.
- **Open the page.** Choose `主页` in the navigation. Run `node scripts/dev/verify/qnote-verify.js nav --route /` and then `node scripts/dev/verify/qnote-verify.js wait --expr "document.body.innerText.includes('QNOTE-VERIFY-9333')" --timeout 20000`. The clipboard watcher records the marker and the list shows it.
- **Search for it.** Type `QNOTE-VERIFY`. Run `node scripts/dev/verify/qnote-verify.js fill --aria "搜索剪贴板记录" --value "QNOTE-VERIFY"`. Only the marker record remains in the list.
- **Copy it back.** Choose `复制内容` on the record. Run `node scripts/dev/verify/qnote-verify.js click --aria "复制内容"`. The button turns into `已复制`.
- **Confirm the stored row.** Run `node scripts/dev/verify/qnote-verify.js db --sql "select id, content from clipboard where content like '%QNOTE-VERIFY-9333%'"`. One row carries the marker.
- **Delete it.** Choose `删除记录`. Run `node scripts/dev/verify/qnote-verify.js click --aria "删除记录"`. The record leaves the list and the database row is gone.
- **Proof.** Run `node scripts/dev/verify/qnote-verify.js shot --out clipboard-list.png`. The screenshot shows the app identity and the history list.

## Gotchas

- The clipboard watcher records whatever the user copies while the instance runs, including during the setup of the run itself. Assert on the marker record, never on the number of records.
- `删除记录` and `复制内容` appear on every record, so `--aria` alone is ambiguous. Narrow it by searching first so only one record matches.
- Writing to the system clipboard disturbs whatever the user had copied. Tell them, and put the original content back afterwards.
- The history lives on the home page. The separate clipboard popup window is a different surface and a different CDP target.
