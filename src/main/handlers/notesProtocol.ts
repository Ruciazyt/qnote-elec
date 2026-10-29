/**
 * 笔记 HTML 预览协议（qnote-note://）
 *
 * ## 为什么要它
 *
 * HTML 笔记预览有两条老路，都有硬伤：
 *
 * 1. **file://** —— 开发环境渲染层跑在 http://localhost，主窗口开着 webSecurity，
 *    file:// 子资源会被整个拦掉，表现为空白且不报错。
 * 2. **iframe srcDoc** —— Chromium 内部把 srcDoc 当 data: URL 处理。
 *    结果是 data: URL 的两条限制都落在笔记上：
 *    锚点导航不被支持（点 <a href="#章节"> 命中
 *    AllowContentInitiatedDataUrlNavigations 安全检查，控制台刷
 *    "Hit debug scenario: 4"），以及脚本拿不到正常的同源环境。
 *
 * 自定义协议是 Electron 官方推荐的做法：它被 Chromium 视作安全来源，
 * 开发 / 生产两种模式下行为一致，锚点、表单、脚本都能正常工作。
 *
 * ## 安全边界
 *
 * 协议只提供「当前笔记根目录内、且是受支持笔记类型」的文件：
 *   - 路径经 NoteStore.resolveSafe 校验，`../` 一律拒绝（否则等于开了一个任意文件读取口）
 *   - 只放行 EXT_TO_TYPE 登记过的扩展名，未知类型一律 403
 *   - HTML 里的本地图片已在渲染前由 readHtmlWithAssets 转成 dataUrl，
 *     所以这里不开放 assets/ 目录的直接访问
 *
 * 渲染层的 iframe 仍带 sandbox 且不含 allow-same-origin —— 协议解决了
 * 「从哪加载」，sandbox 负责「加载后能干什么」，两件事不能互相替代。
 */
import { protocol, net } from "electron";
import * as path from "node:path";
import * as fs from "fs";
import { pathToFileURL } from "node:url";
import { NoteStore } from "../core/noteStore";
import { detectNoteType } from "../../shared/noteTypes";
import { log } from "../utils/log";

/** 协议名。注册后可用 qnote-note:// 访问 */
export const NOTES_PROTOCOL = "qnote-note";

/** 解析笔记绝对路径，供协议回调使用 */
const noteStore = new NoteStore();

/** 扩展名 → MIME，决定浏览器如何解析响应 */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
};

/**
 * 读取笔记目录下的 HTML 文件
 *
 * @param root 笔记根目录（用户设置的绝对路径）
 * @param relPath 相对路径，如 "工作/方案.html"
 * @returns Response，失败时返回带状态码的错误响应
 */
export async function serveNoteHtml(root: string, relPath: string): Promise<Response> {
  let abs: string;
  try {
    // resolveSafe 会拒绝一切越界路径 —— 这是这个协议最重要的一行
    abs = noteStore.resolveForShell(root, relPath);
  } catch {
    return new Response("路径非法", { status: 403 });
  }

  const type = detectNoteType(relPath);
  if (type !== "html") {
    // 只服务 HTML 笔记；其它类型（图片 / PDF / 笔记目录之外的东西）一律拒绝
    return new Response("不支持的类型", { status: 403 });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return new Response("文件不存在", { status: 404 });
  }

  return net.fetch(pathToFileURL(abs).toString());
}

/**
 * 声明协议特权 —— 必须在 app.whenReady() 之前调用。
 *
 * 这是 Electron 的硬性要求：registerSchemesAsPrivileged 只在 ready 前有效，
 * ready 之后调用会抛异常。index.ts 在模块顶层调用本函数，
 * 因此 import 本模块就已经完成了声明。
 *
 * 别和下面的 handle 注册混在一起 —— handle 需要 ready 后的 protocol 模块，
 * 而特权声明必须抢在 ready 之前，两者时机不同，只能拆开。
 */
export function declareNotesScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: NOTES_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        // 允许在 iframe 中加载 —— 否则预览会被 CSP 拦下
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/**
 * 注册协议处理函数
 *
 * 必须在 app.whenReady() 之后调用（特权声明已由 declareNotesScheme 完成）。
 * 用 protocol.handle（而非已废弃的 registerFileProtocol），
 * 走标准 Response 流，不需要手工管理 fd。
 *
 * getRoot 是异步的 —— FileWriter.getFilePath() 要查数据库，
 * 而用户随时可能在笔记页切换目录，所以每次请求都现取，不缓存。
 */
export function registerNotesProtocol(getRoot: () => Promise<string | null>): void {
  protocol.handle(NOTES_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url);
      // host 段用作"相对路径"，因此笔记里出现 / 时不需要额外编码
      const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const root = await getRoot();

      if (!root) {
        return new Response("笔记目录未设置", { status: 503 });
      }
      if (!relPath) {
        return new Response("缺少路径", { status: 400 });
      }

      return await serveNoteHtml(root, relPath);
    } catch (err) {
      log.error("[notes-protocol] 处理请求失败", err);
      return new Response("内部错误", { status: 500 });
    }
  });

  log.info(`笔记预览协议已注册: ${NOTES_PROTOCOL}://`);
}

/** 取扩展名对应的 MIME，供外部调用 */
export function noteHtmlMime(relPath: string): string {
  return MIME_BY_EXT[path.extname(relPath).toLowerCase()] ?? "text/html; charset=utf-8";
}

// 模块加载即声明协议特权 —— 这一行的位置本身就是正确性的一部分：
// app.whenReady() 之前是唯一的合法时机，挪进 whenReady 回调会让它抛异常。
declareNotesScheme();