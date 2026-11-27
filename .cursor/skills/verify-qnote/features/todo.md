# Manage a todo

Todo lets a user record a task with a title, mark it done, archive it, and delete it, and shows the same task in the filter counts and the list.

## Sub-features

- `todo-create` records a new todo from the Todo page.
- `todo-complete` marks a todo done and records the completion time.
- `todo-filter` splits the list into 全部 / 本周 / 待办 / 已完成 / 归档 with counts.
- `todo-edit` reopens a todo for editing.
- `todo-archive` moves a todo into the 归档 view.
- `todo-delete` removes a todo.

## How to get to it (user POV)

- Choose `Todo` in the left navigation.
- Choose `新建 Todo` in the page header.
- Mark a todo done with the checkbox in the list row.
- Archive or delete a todo from the row action buttons.

## Driving it with qnote-verify

Preconditions:

- The instance is healthy (`doctor` reports `ok: true`) and the window is minimized.
- The todo list is empty, or you use a title that does not exist yet.

- **Open the page.** Choose `Todo` in the navigation. Run `node scripts/dev/verify/qnote-verify.js nav --route /todos` and then `node scripts/dev/verify/qnote-verify.js wait --expr "document.body.innerText.includes('新建 Todo')"`. The header reads `Todo` and the filter row shows 全部 / 本周 / 待办 / 已完成 / 归档.
- **Open the editor.** Choose `新建 Todo`. Run `node scripts/dev/verify/qnote-verify.js click --text "新建 Todo"`. A dialog opens with the field placeholder `输入 Todo 标题`.
- **Enter the title.** Type `验证待办-9333`. Run `node scripts/dev/verify/qnote-verify.js fill --placeholder "输入 Todo 标题" --value "验证待办-9333"`. The 保存 button becomes enabled.
- **Save.** Choose `保存`. Run `node scripts/dev/verify/qnote-verify.js click --text "保存"`. The list shows `验证待办-9333` and a toast reads `Todo 已创建`.
- **Confirm the stored row.** Run `node scripts/dev/verify/qnote-verify.js db --sql "select id, title, completed, priority from todo"`. One row has `title` = `验证待办-9333` and `completed` = `0`.
- **Mark it done.** Wait for the list to settle, then choose the row checkbox. Run `node scripts/dev/verify/qnote-verify.js wait --expr "document.body.innerText.includes('验证待办-9333')" --timeout 12000`, then `node scripts/dev/verify/qnote-verify.js click --aria "标记为已完成"`. The row shows a strikethrough and the button becomes `标记为未完成`.
- **Confirm the completion.** Run `node scripts/dev/verify/qnote-verify.js db --sql "select id, title, completed, completed_at from todo"`. `completed` = `1` and `completed_at` is set.
- **Proof.** Run `node scripts/dev/verify/qnote-verify.js shot --out todo-list.png`. The screenshot shows the app identity, the completed todo, and the filter counts.

## Gotchas

- The save button reads `保存中...` while the write is in flight. A click on `保存` that reports the button as `保存` is a failed write, not a missing element.
- The row button changes from `标记为已完成` to `标记为未完成` once the todo is done, so the aria-label in the click command depends on the current state.
- The filter counts sit next to the label as a separate span, so the text of the 全部 tab is `全部1`, not `全部`.
- The instance watches the real system clipboard, so the database also holds clipboard rows. Filter by `title` and never assert on the row count of the whole database.
- The list keeps finished todos visible with a strikethrough. Assert the stored `completed` column, not the absence of the row.
- A click right after a save can land on a stale position while the list re-renders, and the row stays untouched. Wait for the row to appear before the next click, and confirm the stored column instead of trusting that the click was dispatched.
