/**
 * 引用表口令
 *
 * 快照脚本把元素句柄挂在 `window.__qnoteRefs` 上供 click / fill 复用以穿透 shadow DOM 和 iframe。
 * 页面脚本理论上可以自己往这个属性里塞假句柄，把 AI 的写操作骗到别的元素上。
 *
 * 缓解办法很轻：主进程生成一个随机口令，注入脚本建表时写进每条记录，
 * click / fill 取用时校验。页面能看见口令（它就跑在同一个 realm 里），
 * 但要伪造必须先主动读一个它本不该关心的全局变量 —— 足够把「随手覆盖」和「蓄意劫持」区分开，
 * 而且成本几乎为零。
 *
 * 注意：这不是安全边界，只是防误伤。真要防恶意页面得走 CDP isolated world，那是另一个决策。
 */

export const REF_SECRET = `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
