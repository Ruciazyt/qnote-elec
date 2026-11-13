/**
 * 公共目录的默认地址
 *
 * ## 两种填法，各管一段
 *
 * 1. **源码常量** —— 正式版走这条。`DEFAULT_CLOUD_ENDPOINT` 填上部署好的
 *    Worker 地址，重新打包即可。
 * 2. **环境变量** —— 开发期与「从源码直接跑」时用。
 *    `process.env.QNOTE_CLOUD_ENDPOINT`。
 *
 * ## 为什么不是「构建期注入」
 *
 * 主进程是 **tsc** 编译的（不是 esbuild），没有 `define` 那套把变量
 * 烤进产物的东西。`process.env.X` 是在**运行时**读的 —— 打包时它不会被
 * 固定进安装包。所以「CI 里设个环境变量，打出来的包就自带地址」这件事
 * 在当前构建链下**不成立**：装好的包里读到的还是用户机器上的环境变量。
 *
 * 真要免改源码地换地址，两条路：
 *
 * - 把地址写进 `DEFAULT_CLOUD_ENDPOINT`（改一行，重新打包）
 * - 或者让 `scripts/build/post-build.js` 在打包后把地址写进产物里的
 *   一个配置文件 —— 需要的话再加
 *
 * 这是个**公开地址**，不是密钥 —— 它会打进每一个用户的安装包里，
 * 内置它不违反 AGENTS.md 第 4 节（那条红线针对的是 Token / Secret）。
 *
 * 真正的凭据在 Worker 那边：它用 D1 绑定直连数据库，不需要任何 Token。
 */

/**
 * 源码里写死的默认地址 —— 部署完 Worker 后填这里
 *
 * 这就是「所有用户零配置连上同一个公共目录」的落点：
 * 地址非空时，配置读取不到任何设置时默认就用 `public` 后端
 * （见 src/database/cloud/config.ts 的 defaultConfig）。
 *
 * ⚠️ **workers.dev 在中国大陆被 DNS 污染** —— 实测解析到
 * `74.86.151.162` / `2a03:2880:…face:b00c`（Facebook 段，不是 Cloudflare），
 * 大陆用户连不上，市场页会是空的。海外、港澳台正常。
 * 要覆盖大陆用户，得把这个 Worker 绑到自有域名上，把地址换掉。
 *
 * 这是**公开地址**，不是密钥 —— 它会打进每一个用户的安装包里，
 * 内置它不违反 AGENTS.md 第 4 节（那条红线针对的是 Token / Secret）。
 * 真正的凭据在 Worker 那边：它用 D1 绑定直连数据库，不需要任何 Token。
 */
export const DEFAULT_CLOUD_ENDPOINT = "https://qnote-catalog.810945981.workers.dev";

/**
 * 取实际生效的公共目录地址
 *
 * 环境变量优先于常量 —— 开发期改地址不用改源码。
 */
export function resolveDefaultEndpoint(): string {
  const fromEnv = process.env.QNOTE_CLOUD_ENDPOINT?.trim();
  if (fromEnv) return normalizeEndpoint(fromEnv);
  return normalizeEndpoint(DEFAULT_CLOUD_ENDPOINT);
}

/** 去掉末尾的斜杠 —— 拼 URL 时用得上 */
export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}
