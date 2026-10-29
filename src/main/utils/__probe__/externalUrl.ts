/**
 * 交给系统处理的外部链接 —— 协议白名单
 *
 * ## 为什么要有这个
 *
 * `shell.openExternal` 会把 URL 原样交给操作系统的默认处理器。一旦允许
 * `file:`、`javascript:` 或各种自定义协议（ms-msdt:、search-ms: 之类历史上
 * 被用来做参数注入），渲染层就成了任意协议的执行入口 —— 渲染层是可能被
 * 攻陷的一端，不能让它决定「用哪个协议打开」。
 *
 * 所有「渲染层给一个 URL、主进程去打开」的入口都要过这里，不要各写各的。
 */

/** 允许交给系统默认程序处理的协议 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * 解析并校验一个待打开的外部链接
 *
 * @param raw 原始 URL 字符串
 * @returns 校验通过的 URL 对象；格式不对或协议不在白名单里返回 null
 */
export function parseExternalUrl(raw: string): URL | null {
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;

  return parsed;
}

/**
 * 校验一个待打开的外部链接，只关心是否允许
 *
 * @param raw 原始 URL 字符串
 * @returns 允许返回 true
 */
export function isAllowedExternalUrl(raw: string): boolean {
  return parseExternalUrl(raw) !== null;
}
