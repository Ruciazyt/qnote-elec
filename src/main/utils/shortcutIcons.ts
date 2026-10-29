/**
 * 快捷方式图标解析
 *
 * 三种快捷方式取图标的途径完全不同，逐个说清为什么这么绕：
 *
 * 1. **网页链接 → favicon**
 *    没有走渲染层直接 <img src="https://...">。一是开发环境页面来自
 *    http://localhost、打包后来自 file://，远程图片的加载时机不可控；
 *    二是那样等于每次开面板都要重新联网取一遍。本模块在主进程取好、
 *    落盘缓存成 PNG，再以 data URL 回给渲染层，代价只有一次启动内首次的几百毫秒。
 *
 * 2. **本地程序 → exe 自带图标**
 *    Electron 的 nativeImage.createFromPath() 只能读图片文件，读 .exe 会返回空图 ——
 *    图标是 PE 资源段里的东西，不是文件内容。这里借一次 powershell.exe 调
 *    托管的 Icon.ExtractAssociatedIcon 取出来，再落盘成 PNG。
 *    脚本正文**全是 ASCII**（注释也不含中文）：源码经 tsc 编译后仍是无 BOM 的
 *    UTF-8，而 PowerShell 5.1 按系统 ANSI 读 .ps1，正文一旦含非 ASCII 就会被
 *    当成 GBK 解码，行尾的 0x5C 还会把下一行一起吞掉。
 *    路径本身（可能是中文）走环境变量传入，不进脚本正文。
 *
 * 3. **本地文件夹 → 不取图标**
 *    文件夹的图标是 shell 的按需合成资源（SHGetFileInfo 一类的私有 API），
 *    没有任何公开的稳定接口能跨进程拿到。而"文件夹就该是文件夹样"本身
 *    就是用户预期，渲染层用 lucide 的 Folder 图标反而更贴合本应用的视觉语言，
 *    还自动跟随明暗主题。少一条依赖 Win32 的链路是划算的。
 */
import { app, nativeImage } from "electron";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { log } from "./log";

const execFileAsync = promisify(execFile);

export type ShortcutKind = "url" | "app" | "folder";

/**
 * 回给渲染层的数据 URL 边长上限
 *
 * 图块显示尺寸约 36px，96px 足够覆盖 2x 屏。再大只会让 data URL 变长、
 * 让每次 shortcut:list 的返回体膨胀，而肉眼分辨不出差别。
 */
const DATA_URL_MAX_PX = 96;

/** 图标缓存目录：<userData>/shortcut-icons */
function cacheDir(): string {
  return path.join(app.getPath("userData"), "shortcut-icons");
}

/**
 * 进程内缓存
 *
 * value 为 data URL；null 表示**已确认取不到**（比如站点没有 favicon），
 * 和"还没试过"是两回事 —— 否则每次启动都要为同一个失败目标再付一次网络超时。
 */
const memCache = new Map<string, string | null>();

/** 正在进行的解析，避免渲染层重复请求时并发打同一批请求 */
const inflight = new Map<string, Promise<string | null>>();

/** 缓存键：kind + target。target 一律先归一化，避免同一目标因写法不同重复落盘 */
function cacheKey(kind: ShortcutKind, target: string): string {
  return `${kind}:${normalizeTarget(kind, target)}`;
}

/** 路径统一成分隔符一致、去尾分隔符的形式（根目录除外） */
function normalizeTarget(kind: ShortcutKind, target: string): string {
  if (kind !== "url") {
    const trimmed = target.trim();
    try {
      const normalized = path.normalize(trimmed);
      // C:\ 归一化后仍是 C:\，不能把尾分隔符削掉
      // （^ 锚住 + 捕获前缀，避免未锚定正则的 O(n²) 回溯，见 SonarCloud S8786）
      return normalized.length > 3 ? normalized.replace(/^((?:[\s\S]*[^\\/])?)[\\/]+$/, "$1") : normalized;
    } catch {
      return trimmed;
    }
  }
  return target.trim();
}

function cacheFile(key: string): string {
  // sha256 而不是 sha1：sha1 已被判定为弱哈希（SonarCloud S4790，安全热点），
  // 这里只是拿来做缓存文件名，不存在兼容旧文件的负担
  const hash = createHash("sha256").update(key).digest("hex");
  return path.join(cacheDir(), `${hash}.png`);
}

/** 把任意图片字节收敛成 ≤96px 的 PNG data URL；解不出图就返回 null */
function toPngDataUrl(buffer: Buffer): string | null {
  try {
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    const longest = Math.max(width, height);
    // 只缩小不放大：把 16px 的 favicon 拉到 96px 只会得到一块糊掉的马赛克
    const resized =
      longest > DATA_URL_MAX_PX
        ? image.resize({
            width: Math.max(1, Math.round((width / longest) * DATA_URL_MAX_PX)),
            height: Math.max(1, Math.round((height / longest) * DATA_URL_MAX_PX)),
            quality: "best",
          })
        : image;
    return resized.toDataURL();
  } catch {
    return null;
  }
}

/** 读磁盘缓存命中即返回 */
function readDiskCache(key: string): string | null {
  try {
    const file = cacheFile(key);
    if (!fs.existsSync(file)) return null;
    return toPngDataUrl(fs.readFileSync(file));
  } catch {
    return null;
  }
}

/** 写磁盘缓存；失败不影响本次返回，图标只是下次重新取而已 */
function writeDiskCache(key: string, dataUrl: string): void {
  try {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return;
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(cacheFile(key), Buffer.from(dataUrl.slice(comma + 1), "base64"));
  } catch (err) {
    log.warn("[shortcut-icon] 写图标缓存失败:", err);
  }
}

// ---------------------------------------------------------------------------
// 1. favicon
// ---------------------------------------------------------------------------

/** 单次请求超时。取不到就回落到首字母头像，绝不让快捷方式面板干等着 */
const FETCH_TIMEOUT_MS = 3500;

/** 带超时的 fetch —— 默认 fetch 不接受超时，卡住的连接会一直挂着 */
async function fetchWithTimeout(url: string, accept: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: accept, "User-Agent": "QNote/1.0 (shortcut icon resolver)" },
    });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 只接受看起来像图片的响应，避免把对方的 404 HTML 存成"图标" */
async function readImage(res: Response): Promise<Buffer | null> {
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (type && !type.startsWith("image/")) return null;
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    // 至少要有个 1x1 以外的体积，挡掉空响应和某些站点的占位图
    return buf.length > 32 ? buf : null;
  } catch {
    return null;
  }
}

/** 从 HTML 里抠出 <link rel="icon"> / "shortcut icon" 的 href */
function parseIconHref(html: string, base: string): string | null {
  const re = /<link[^>]+>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const tag = match[0];
    if (!/rel\s*=\s*["']?([^"'>]{0,512}\bicon\b)/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!href) continue;
    try {
      return new URL(href[1], base).toString();
    } catch {
      /* href 是怪东西就跳过，继续找下一个 */
    }
  }
  return null;
}

async function fetchFavicon(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // 直奔 /favicon.ico —— 绝大多数站点都放在这，省一次 HTML 拉取
  const direct = await fetchWithTimeout(`${parsed.origin}/favicon.ico`, "image/*");
  if (direct) {
    const buf = await readImage(direct);
    const dataUrl = buf ? toPngDataUrl(buf) : null;
    if (dataUrl) return dataUrl;
  }

  // 拿不到就翻页面 <head>，很多站点（尤其是 SPA）只在这里声明图标
  const page = await fetchWithTimeout(parsed.toString(), "text/html,application/xhtml+xml");
  if (!page) return null;
  let html = "";
  try {
    html = await page.text();
  } catch {
    return null;
  }
  const href = parseIconHref(html, page.url || parsed.toString());
  if (!href) return null;
  const iconRes = await fetchWithTimeout(href, "image/*");
  if (!iconRes) return null;
  const buf = await readImage(iconRes);
  return buf ? toPngDataUrl(buf) : null;
}

// ---------------------------------------------------------------------------
// 2. exe 图标
// ---------------------------------------------------------------------------

/**
 * 取图标用的 PowerShell 脚本
 *
 * 全部为 ASCII，连注释也不能有中文：正文会被编译进 dist，运行时由 PowerShell 5.1
 * 按系统 ANSI（中文 Windows 上是 GBK）读，一个无 BOM 的 UTF-8 中文注释会被解成乱码；
 * 而 GBK 的双字节序列里第二个字节可能正好是 0x5C（反斜杠），在行尾会被当成续行符，
 * 把下一行一起吞掉 —— 表现为莫名其妙的语法错误。
 *
 * 为什么是纯 PowerShell 脚本而不是 Add-Type + C#：
 * 托管 API（System.Drawing.Icon）本来就能直接从 PowerShell 调，
 * 包一层 Add-Type 只是多一次 Roslyn 编译 —— 实测 3.0s vs 1.7s。
 * 剩下那 1.7s 基本全是 powershell.exe 的进程启动，省不掉。
 *
 * 为什么不用 PrivateExtractIcons 取 256px 大图标：
 * 它在 shell32.dll 里**只按序号导出、没有具名导出**，得用 EntryPoint="#170" 挂。
 * 实测 170 并不是这个函数，直接触发 AccessViolationException 把 PowerShell 整个带崩
 * （退出码 0xC0000005）。为一块 36px 的图块冒进程崩溃的风险不划算。
 * 图标固定 32x32；要更大的高清图标只能自己解析 PE 资源段或挂原生模块。
 */
const ICON_SCRIPT = `$ErrorActionPreference = 'Stop'
$src = $env:QNOTE_ICON_SRC
$dst = $env:QNOTE_ICON_DST
if ([string]::IsNullOrWhiteSpace($src)) { throw 'missing src' }

# A .lnk holds the shortcut itself, not the program, so extracting from it
# directly would yield the generic "shortcut" icon. Resolve the real target first.
if ([System.IO.Path]::GetExtension($src).ToLowerInvariant() -eq '.lnk') {
    $shell = New-Object -ComObject WScript.Shell
    $target = $shell.CreateShortcut($src).TargetPath
    if (-not [string]::IsNullOrWhiteSpace($target)) { $src = $target }
}

Add-Type -AssemblyName System.Drawing
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon($src)
if ($ico -eq $null) { throw 'no icon' }
try {
    $bmp = $ico.ToBitmap()
    try {
        $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $bmp.Dispose()
    }
} finally {
    $ico.Dispose()
}
`;

/**
 * 跑一次图标提取脚本
 *
 * 脚本文件按 ASCII 写：正文本来就没有非 ASCII 字符，显式指定 ascii 可以
 * 保证任何情况下都不会掺进 BOM。
 */
async function runIconScript(target: string, outFile: string): Promise<boolean> {
  const scriptFile = path.join(os.tmpdir(), `qnote-icon-${process.pid}-${Date.now()}.ps1`);
  try {
    fs.writeFileSync(scriptFile, ICON_SCRIPT, "ascii");

    // 路径走环境变量而不是拼进 -Command：命令行参数经过系统代码页转换，
    // 中文路径会被打乱；环境变量是 UTF-16 直传，PowerShell 读出来是原样。
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptFile],
      {
        timeout: 20_000,
        windowsHide: true,
        env: { ...process.env, QNOTE_ICON_SRC: target, QNOTE_ICON_DST: outFile },
      }
    );

    if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) return false;
    return true;
  } catch (err) {
    log.warn("[shortcut-icon] 提取程序图标失败:", err instanceof Error ? err.message : err);
    return false;
  } finally {
    try {
      if (fs.existsSync(scriptFile)) fs.unlinkSync(scriptFile);
    } catch {
      /* 临时文件删不掉不影响功能 */
    }
  }
}

async function extractAppIcon(target: string): Promise<string | null> {
  const normalized = normalizeTarget("app", target);
  if (!fs.existsSync(normalized)) {
    log.warn("[shortcut-icon] 目标不存在，跳过图标提取:", normalized);
    return null;
  }
  if (process.platform !== "win32") {
    log.info("[shortcut-icon] 非 Windows 平台，跳过 exe 图标提取:", normalized);
    return null;
  }

  // 先落到临时文件再读，避免和缓存目录里的半成品同名冲突
  const tmp = path.join(os.tmpdir(), `qnote-icon-${process.pid}-${Date.now()}.png`);
  try {
    const ok = await runIconScript(normalized, tmp);
    if (!ok) return null;
    return toPngDataUrl(fs.readFileSync(tmp));
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

async function resolveUncached(kind: ShortcutKind, target: string): Promise<string | null> {
  const key = cacheKey(kind, target);
  const hit = readDiskCache(key);
  if (hit) return hit;

  let result: string | null = null;
  try {
    if (kind === "url") {
      result = await fetchFavicon(normalizeTarget("url", target));
    } else if (kind === "app") {
      result = await extractAppIcon(target);
    }
    // folder 恒为 null：界面用 lucide 的 Folder 图标，见文件头注释
  } catch (err) {
    log.warn("[shortcut-icon] 解析图标失败:", err);
    result = null;
  }

  if (result) writeDiskCache(key, result);
  // 失败也写进内存：同一目标不会被反复重试
  memCache.set(key, result);
  return result;
}

/**
 * 取单个快捷方式的图标
 *
 * 三个来源：磁盘缓存 → 内存缓存（含失败记录）→ 实际解析。
 * 返回 null 表示取不到，渲染层会回落到首字母色块 / 文件夹图标。
 */
export async function resolveShortcutIcon(kind: ShortcutKind, target: string): Promise<string | null> {
  const key = cacheKey(kind, target);

  if (memCache.has(key)) return memCache.get(key) ?? null;
  const disk = readDiskCache(key);
  if (disk) {
    memCache.set(key, disk);
    return disk;
  }

  const pending = inflight.get(key);
  // 显式比 undefined，不要用 if (pending) ——
  // Promise 对象恒为真，写成布尔条件容易被误读成「判断 promise 的状态」
  if (pending !== undefined) return pending;

  const task = resolveUncached(kind, target).finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

/**
 * 批量解析 —— 渲染层拿到列表后调一次即可
 *
 * 刻意与 shortcut:list 分开：解析可能要联网（favicon 超时 3.5s），
 * 塞进列表接口会让整个快捷方式面板陪着一起等。
 */
export async function resolveShortcutIcons(
  items: Array<{ kind: ShortcutKind; target: string }>
): Promise<Array<string | null>> {
  return Promise.all(items.map((item) => resolveShortcutIcon(item.kind, item.target)));
}

/** 清空进程内缓存（设置页「清除图标缓存」用） */
export function clearShortcutIconMemoryCache(): void {
  memCache.clear();
}
