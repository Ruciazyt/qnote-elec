/**
 * 应用级共享状态
 *
 * 目前只有一件事：**是否正在退出**。
 *
 * ## 为什么退出状态必须是全局唯一的一份
 *
 * 退出流程横跨两个模块：
 *   - `index.ts` 负责 app.quit() 之前的收尾（停监听、关数据库、销毁托盘）
 *   - `mainWindow.ts` 负责"窗口被关闭时是收进托盘，还是真的要退出"
 *
 * 之前两边各自维护一个 `isQuitting` 布尔量，而**只有标题栏的 X 按钮**
 * 会同时把两者都置上；托盘菜单的「退出」直接调 `app.quit()`，
 * 只置了 index.ts 那一侧，mainWindow.ts 那边仍然是 false。
 *
 * 于是退出流程变成这样：
 *   app.quit()
 *     → before-quit：数据库连接池被销毁（knex 的 pool 被置空）
 *     → Electron 去关主窗口 → 窗口的 close 处理器发现自己的标志位还是 false
 *       → 窗口藏进托盘 + event.preventDefault()
 *     → 退出流程被取消，应用继续活着
 *
 * 结果是一个**僵尸实例**：界面还在、能点，但所有数据库操作都抛
 * `Unable to acquire a connection`（knex 在池被销毁后就是这个报错）。
 * 用户看到的现象是"清空记录""添加快捷方式"这类写库功能突然全都不灵了，
 * 而应用看起来一切正常。
 *
 * 结论：任何一个发起退出的入口都算退出，标志位必须共享。
 */

let quitting = false;

/**
 * 标记应用正在退出
 *
 * 在 `before-quit` 里调用即可 —— 它早于 Electron 关闭任何窗口，
 * 因此窗口的 close 处理器一定能看到这个状态。
 */
export function markQuitting(): void {
  quitting = true;
}

/** 当前是否处于退出流程中 */
export function isQuitting(): boolean {
  return quitting;
}

/**
 * 主窗口被关闭时，应该"收进托盘"还是"真的关掉"
 *
 * 这是整个退出流程里最关键的一个判断，也是之前出 bug 的那一步：
 * 判断依据必须是**全局**退出状态，而不是"这个窗口自己有没有收到过关闭请求"。
 *
 * 收进托盘 = 取消关闭动作 = 退出流程在这里中止。
 * 所以只要应用已经在退出流程中，就绝不能再取消关闭。
 */
export function shouldHideToTray(): boolean {
  return !quitting;
}
