# Create a note

Notes lets a user create a note file in a folder of the notes tree, see it appear in the tree, and open it in the editor.

## Sub-features

- `note-menu` opens the tree context menu on empty space and on a folder.
- `note-create` creates a new note of the chosen type in the chosen folder.
- `note-tree` shows the new note in the tree.
- `note-open` opens the note in the editor.

## How to get to it (user POV)

- Choose `笔记` in the left navigation.
- Right-click empty space in the notes tree to create in the root folder, or right-click a folder to create inside it.
- Choose `新建文件`, then the note type.
- Type a file name and confirm.

## Driving it with qnote-verify

Preconditions:

- The instance is healthy (`doctor` reports `ok: true`) and the window is minimized.
- The notes tree is empty, so the right-click lands on the empty-state area.

- **Open the page.** Choose `笔记` in the navigation. Run `node scripts/dev/verify/qnote-verify.js nav --route /notes` and then `node scripts/dev/verify/qnote-verify.js wait --expr "document.body.innerText.includes('笔记')"`. The tree area shows the empty-state text `右键空白处新建`.
- **Open the context menu.** Right-click the empty tree area. Run `node scripts/dev/verify/qnote-verify.js click --right --selector "[role='group'][aria-label='笔记操作']"` or target the empty-state paragraph with `--text "右键空白处新建"`. A menu appears with the header `在「根目录」下新建`.
- **Choose the type.** Choose `新建文件`, then `文本`. Run `node scripts/dev/verify/qnote-verify.js click --text "新建文件"` and `node scripts/dev/verify/qnote-verify.js click --text "文本"`. A name dialog opens with the placeholder `请输入文件名（无需后缀）`.
- **Name it.** Type `验证笔记-9333`. Run `node scripts/dev/verify/qnote-verify.js fill --placeholder "请输入文件名（无需后缀）" --value "验证笔记-9333"`.
- **Confirm.** Run `node scripts/dev/verify/qnote-verify.js click --text "确定"` or press `Enter`. A toast reads `已新建笔记` and the tree lists `验证笔记-9333`.
- **Confirm on disk.** Run `node scripts/dev/verify/qnote-verify.js eval --expr "document.body.innerText.includes('验证笔记-9333')"`. The result is `true`, and the file exists under the instance's notes directory in `<tree>/udata/notes`.
- **Proof.** Run `node scripts/dev/verify/qnote-verify.js shot --out notes-tree.png`. The screenshot shows the new note in the tree.

## Gotchas

- Creation goes through a right-click context menu. A left click on the tree only expands a folder or changes where new files land.
- The creatable note types are 绘图 / 文本 / 网页. 图片 and PDF exist as note types but are not offered in the create menu.
- The dialog title follows the chosen type, for example `新建文本笔记`, while the empty-state dialog title is `新建笔记`.
- The notes tree writes into the instance's own notes directory under `<tree>/udata/notes`, so the repo's notes are never touched.
