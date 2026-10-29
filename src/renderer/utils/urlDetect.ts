/**
 * 剪贴板内容里的网页地址识别
 *
 * 剪贴板里最常见的一类内容就是链接 —— 从聊天窗口复制、从地址栏复制、
 * 从文档里复制。识别出来之后，列表就能给出「直接打开」和「收进快捷方式」
 * 两个动作，不必用户先把链接粘到地址栏。
 *
 * ## 判定有多严
 *
 * 只有**整条内容本身就是链接**才算数。一段正文里恰好出现了某个网址
 * （技术文档里的参考链接之类）不算 —— 否则每条长文本记录都会冒出一个
 * 「打开链接」按钮，而点开的是正文里某个不相干的地址。
 *
 * ## 为什么只认 http / https
 *
 * 主进程 `shell.openExternal` 的协议白名单里虽然还有 mailto，但「网页」
 * 在日常说法里指的就是 http(s) 页面；快捷方式那边也只接受 http / https
 * （见 shortcutHandlers.normalizeInput）。两边口径一致，少一类意外。
 */

/** 复制时常见的包裹符号 —— 必须成对出现才剥 */
const WRAPPERS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
  ["<", ">"],
  ["【", "】"],
];

/**
 * 剥掉成对的包裹符号
 *
 * 从聊天软件复制链接时经常会连着引号或书名号一起带走，这些符号不是
 * URL 的一部分，交给 URL 解析器会直接失败。
 */
function stripWrapping(text: string): string {
  let out = text;
  for (const [open, close] of WRAPPERS) {
    if (out.length >= 2 && out.startsWith(open) && out.endsWith(close)) {
      out = out.slice(open.length, out.length - close.length).trim();
    }
  }
  return out;
}

/**
 * 裸域名的形状（没有协议）
 *
 * 至少两段、每段非空，且最后一段至少两个字符 —— 顶级域名不会只有一个字母。
 * 这样 `www.a.com` 认，`www.c` 不认。
 */
const BARE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * 判断一段剪贴板内容是不是网页地址
 *
 * @param raw 剪贴板原文
 * @returns 是网页地址时返回归一化后的 URL，否则返回 null
 */
export function detectUrl(raw: string): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 多行内容一律不算链接：正文里带网址的段落、Markdown 列表都归到这里
  if (/[\r\n]/.test(trimmed)) return null;

  const candidate = stripWrapping(trimmed);
  if (!candidate) return null;

  // 裸域名补一个协议。没有这一步，从聊天里复制出来的 "www.xxx.com"
  // 会被判成普通文本，用户最常遇到的那一类链接反而识别不出来。
  const withScheme = /^https?:\/\//i.test(candidate)
    ? candidate
    : BARE_HOST.test(candidate)
      ? `https://${candidate}`
      : null;
  if (!withScheme) return null;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  // 主机名至少要像个域名。`http://foo` 这种能解析过 URL 语法但显然不是
  // 用户想打开的地址，不放行；localhost 和 IP 是开发地址，保留。
  if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") return null;

  return parsed.toString();
}

/**
 * 内容是不是网页地址 —— 只关心「是/不是」时用这个
 */
export function isWebUrl(raw: string): boolean {
  return detectUrl(raw) !== null;
}
