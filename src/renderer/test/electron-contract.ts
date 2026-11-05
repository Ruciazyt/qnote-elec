import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * IPC 契约的静态解析
 *
 * 这个项目里「新增 IPC 要改三处」全靠人记着，漏一处不报错 ——
 * 真机上表现为 undefined，单元测试因为桩是 Proxy 兜底，同样全绿。
 * 这里把三处都静态解析出来，让漂移变成一条会红的断言：
 *
 *   1. src/main/preload.ts —— 真正暴露给渲染层的 API
 *   2. src/renderer/electron.d.ts —— 渲染层看到的类型声明
 *   3. src/renderer/** —— 渲染层实际调用的 API
 *
 * 解析走 TypeScript 编译器 API，不用正则 —— preload 里存在一行放两个键
 * （getFloatingAiState / setFloatingAiPosition）和跨行的成员签名，正则会漏。
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** 渲染层看到的类型声明 */
export const ELECTRON_DTS_PATH = path.resolve(here, "../electron.d.ts");
/** preload 真正暴露的 API */
export const PRELOAD_PATH = path.resolve(here, "../../main/preload.ts");
/** 渲染层源码根目录（调用点扫描用） */
export const RENDERER_ROOT = path.resolve(here, "..");
/** 主进程源码根目录（注册点扫描用） */
export const MAIN_ROOT = path.resolve(here, "../../main");

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function createSourceFile(filePath: string, text: string): ts.SourceFile {
  return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** 取成员名；支持 `foo(): void` 与 `"foo": () => void` 两种写法 */
function memberName(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

/**
 * 解析 electron.d.ts 里 interface ElectronAPI 的成员名
 *
 * 只认这一个接口 —— 渲染层能用的 API 就是它声明的那些。
 */
export function parseDeclaredApiNames(source: string): string[] {
  const sf = createSourceFile("electron.d.ts", source);
  const names: string[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isInterfaceDeclaration(stmt) || stmt.name.text !== "ElectronAPI") continue;
    for (const member of stmt.members) {
      const name = memberName(member.name);
      if (name) names.push(name);
    }
  }

  return names;
}

/**
 * 找到 preload 里 exposeInMainWorld("electron", {...}) 那个对象字面量
 *
 * 只认第一个参数是 "electron" 的那次调用 —— 别的名字不是渲染层 API。
 */
export function findExposedObjectLiteral(
  source: string
): ts.ObjectLiteralExpression | null {
  const sf = createSourceFile("preload.ts", source);
  let found: ts.ObjectLiteralExpression | null = null;

  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const isExpose = node.expression.name.text === "exposeInMainWorld";
      const firstArg = node.arguments[0];
      const isElectronWorld =
        firstArg && ts.isStringLiteral(firstArg) && firstArg.text === "electron";

      if (isExpose && isElectronWorld) {
        const payload = node.arguments[1];
        if (payload && ts.isObjectLiteralExpression(payload)) found = payload;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return found;
}

/**
 * 解析 preload.ts 里 contextBridge.exposeInMainWorld("electron", {...}) 的键
 *
 * 只认第一个参数是 "electron" 的那次调用 —— 别的名字不是渲染层 API。
 */
export function parseExposedApiNames(source: string): string[] {
  const payload = findExposedObjectLiteral(source);
  if (!payload) return [];

  const names: string[] = [];
  for (const prop of payload.properties) {
    const name = memberName(prop.name);
    if (name) names.push(name);
  }
  return names;
}

/** 收集目录下的源码文件，跳过依赖与构建产物 */
export function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", "dist", "dist_electron", ".git", "coverage"]);

  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        out.push(full);
      }
    }
  };

  walk(dir);
  return out;
}

/**
 * 扫描渲染层源码，找出实际调用了 `window.electron.<api>` 的地方
 *
 * 返回 api → 调用点文件列表的映射。渲染层只允许调用「preload 暴露了
 * 且 electron.d.ts 声明了」的 API，否则这里就会列出越界的名字。
 */
export function parseRendererApiUsages(root: string = RENDERER_ROOT): Map<string, string[]> {
  const usages = new Map<string, string[]>();

  for (const file of collectSourceFiles(root)) {
    const sf = createSourceFile(file, readSource(file));

    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node)) {
        const expr = node.expression;
        const isElectronObject =
          ts.isPropertyAccessExpression(expr) &&
          expr.name.text === "electron" &&
          ts.isIdentifier(expr.expression) &&
          expr.expression.text === "window";

        if (isElectronObject) {
          const api = node.name.text;
          const list = usages.get(api) ?? [];
          list.push(path.relative(root, file));
          usages.set(api, list);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return usages;
}

/** 三份名单比对的结果 */
export interface ContractDiff {
  /** 暴露了但没声明 —— 渲染层调用得到，类型却查不到 */
  exposedButNotDeclared: string[];
  /** 声明了但没暴露 —— 类型还在，preload 已经删了（真机上调用即 undefined） */
  declaredButNotExposed: string[];
  /**
   * 渲染层可以调用的 API：两边都有才算数
   *
   * 只有这一组能进桩的白名单 —— 少一边都意味着这条 IPC 是断的。
   */
  allowed: Set<string>;
  /** 渲染层调了但两边都没有 —— 断链 */
  usagesOutsideContract: string[];
}

/**
 * 比对三份名单，得出漂移
 *
 * 拆成纯函数是为了能拿变异输入验它：改了判定逻辑而用例还绿，
 * 那这条守卫就是假的安全网。
 */
export function compareContract(input: {
  declared: string[];
  exposed: string[];
  usages: Map<string, string[]>;
}): ContractDiff {
  const declaredSet = new Set(input.declared);
  const exposedSet = new Set(input.exposed);

  return {
    exposedButNotDeclared: input.exposed.filter((name) => !declaredSet.has(name)),
    declaredButNotExposed: input.declared.filter((name) => !exposedSet.has(name)),
    allowed: new Set(input.declared.filter((name) => exposedSet.has(name))),
    usagesOutsideContract: [...input.usages.keys()].filter(
      (name) => !declaredSet.has(name) || !exposedSet.has(name)
    ),
  };
}

/**
 * 读 preload 与 electron.d.ts 两份名单（带缓存）
 *
 * 桩每个用例前都要装一次，解析结果必须缓存 ——
 * 不缓存的话每个用例都重读两个文件、重建一遍语法树，整套用例要多跑十几秒。
 */
let apiNamesCache: { declared: string[]; exposed: string[] } | null = null;

export function readApiNames(): { declared: string[]; exposed: string[] } {
  if (!apiNamesCache) {
    apiNamesCache = {
      declared: parseDeclaredApiNames(readSource(ELECTRON_DTS_PATH)),
      exposed: parseExposedApiNames(readSource(PRELOAD_PATH)),
    };
  }
  return apiNamesCache;
}

/**
 * 渲染层可以调用的 API：preload 暴露了、且 electron.d.ts 声明了
 *
 * 少一边都意味着这条 IPC 是断的 —— 桩只放行这一组。
 */
let allowedCache: Set<string> | null = null;

export function readAllowedApiNames(): Set<string> {
  if (!allowedCache) {
    const { declared, exposed } = readApiNames();
    const exposedSet = new Set(exposed);
    allowedCache = new Set(declared.filter((name) => exposedSet.has(name)));
  }
  return allowedCache;
}

/**
 * 解析当前仓库的三份 API 名单
 *
 * 含渲染层全量源码扫描，只给契约用例用 —— 桩只取上面两份名单。
 */
export function readContract() {
  const { declared, exposed } = readApiNames();
  const usages = parseRendererApiUsages();

  return { declared, exposed, usages, ...compareContract({ declared, exposed, usages }) };
}

/* ============================================================
 * channel 级：preload 的通道在主进程有没有接收方
 *
 * 上面那套是 API 名级的 —— 它看的是「渲染层能不能拿到这个函数」。
 * 这一层看的是「这个通道在主进程有没有人接」：
 * preload invoke 的通道必须有人 ipcMain.handle，send 的必须有人 ipcMain.on。
 * 两者的失败模式不同 —— API 名对得上、通道没人接，一样是静默失效。
 * ============================================================ */

/** preload 侧的通道，按调用方式分 */
export interface PreloadChannels {
  /** ipcRenderer.invoke —— 主进程要用 ipcMain.handle 接 */
  invoke: string[];
  /** ipcRenderer.send —— 主进程要用 ipcMain.on 接 */
  send: string[];
  /** ipcRenderer.on —— 主进程要往外发 */
  listen: string[];
  /** 通道名不是字面量的调用（万能 send 这类） */
  dynamic: { api: string; kind: "invoke" | "send" | "on" }[];
}

/** 主进程侧的注册点 */
export interface MainChannels {
  /** ipcMain.handle 接的通道 */
  handled: string[];
  /** ipcMain.on 接的通道 */
  listened: string[];
  /** 扫描到的文件（相对 src/main） */
  files: string[];
  /** 通道参数不是字面量的注册点 —— 静态判不了，记下来 */
  unresolved: { file: string; kind: string }[];
}

const IPC_RENDERER_METHODS = new Set(["invoke", "send", "on"]);

/**
 * 解析 preload 里每个 API 实际打到了哪些通道
 *
 * 按 API 分组扫描 —— 一个 API 可能打多个通道（比如既 invoke 又 send），
 * 断言要按通道去重，不能按 API 计数。
 */
export function parsePreloadChannels(source: string): PreloadChannels {
  const result: PreloadChannels = { invoke: [], send: [], listen: [], dynamic: [] };
  const payload = findExposedObjectLiteral(source);
  if (!payload) return result;

  for (const prop of payload.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const api = memberName(prop.name);
    if (!api || !prop.initializer) continue;

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const callee = node.expression;
        const isIpcRenderer =
          ts.isIdentifier(callee.expression) && callee.expression.text === "ipcRenderer";
        const method = callee.name.text;

        if (isIpcRenderer && IPC_RENDERER_METHODS.has(method)) {
          const channelArg = node.arguments[0];
          if (channelArg && ts.isStringLiteral(channelArg)) {
            const bucket =
              method === "invoke" ? result.invoke : method === "send" ? result.send : result.listen;
            if (!bucket.includes(channelArg.text)) bucket.push(channelArg.text);
          } else {
            // 通道名不是字面量 —— 万能通道，静态判不了
            result.dynamic.push({ api, kind: method as "invoke" | "send" | "on" });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(prop.initializer);
  }

  return result;
}

/**
 * 扫描主进程，收集 ipcMain.handle / ipcMain.on 注册的通道
 *
 * 扫描范围是整个 src/main —— 注册点不只在 handlers/，
 * 窗口相关的在 core/window/，应用级的在 index.ts。
 * 只扫 handlers/ 会漏掉窗口那几条通道，漏了就会出现假断链。
 */
export function parseMainChannels(root: string = MAIN_ROOT): MainChannels {
  const result: MainChannels = { handled: [], listened: [], files: [], unresolved: [] };

  for (const file of collectSourceFiles(root)) {
    if (/\.(test|spec)\.tsx?$/.test(file)) continue;

    const rel = path.relative(root, file).split(path.sep).join("/");
    result.files.push(rel);
    const sf = createSourceFile(file, readSource(file));

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const callee = node.expression;
        const isIpcMain =
          ts.isIdentifier(callee.expression) && callee.expression.text === "ipcMain";
        const method = callee.name.text;

        if (isIpcMain && (method === "handle" || method === "on")) {
          const channelArg = node.arguments[0];
          if (channelArg && ts.isStringLiteral(channelArg)) {
            const bucket = method === "handle" ? result.handled : result.listened;
            if (!bucket.includes(channelArg.text)) bucket.push(channelArg.text);
          } else {
            result.unresolved.push({ file: rel, kind: method });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return result;
}

/* ============================================================
 * channel 级：主进程往渲染层发的通道
 *
 * preload 的 ipcRenderer.on(channel) 要有人在主进程往这个通道发东西，
 * 否则渲染层注册了监听却永远收不到消息 —— 静默失效，跟没注册一样。
 * ============================================================ */

/** 主进程外发的通道 */
export interface MainSendChannels {
  /** 直接 webContents.send / sender.send 发的通道（含常量通道名） */
  direct: string[];
  /** 走辅助函数（send / broadcast / notify 这类）发的通道 */
  helper: string[];
  /** 扫描到的文件 */
  files: string[];
}

/**
 * 扫描主进程，收集往渲染层发的通道
 *
 * 三种写法都要认：
 *   - win.webContents.send("x")        → 直接发
 *   - win.webContents.send(常量, ...)   → 常量通道名（updater 的 UPDATE_STATUS_CHANNEL）
 *   - send("x", payload) / broadcast("x", ...) → 辅助函数转发，通道名在调用点
 */
export function parseMainSendChannels(root: string = MAIN_ROOT): MainSendChannels {
  const result: MainSendChannels = { direct: [], helper: [], files: [] };
  const push = (bucket: string[], channel: string) => {
    if (!bucket.includes(channel)) bucket.push(channel);
  };

  for (const file of collectSourceFiles(root)) {
    if (/\.(test|spec)\.tsx?$/.test(file)) continue;

    const rel = path.relative(root, file).split(path.sep).join("/");
    result.files.push(rel);
    const sf = createSourceFile(file, readSource(file));

    // 文件里的常量通道名：const UPDATE_STATUS_CHANNEL = "update:status"
    const constStrings = new Map<string, string>();
    for (const stmt of sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          ts.isStringLiteral(decl.initializer)
        ) {
          constStrings.set(decl.name.text, decl.initializer.text);
        }
      }
    }

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;

        if (ts.isPropertyAccessExpression(callee) && callee.name.text === "send") {
          const arg = node.arguments[0];
          if (arg && ts.isStringLiteral(arg)) {
            push(result.direct, arg.text);
          } else if (arg && ts.isIdentifier(arg) && constStrings.has(arg.text)) {
            push(result.direct, constStrings.get(arg.text)!);
          }
        }

        // 辅助函数转发：send("x", ...) / broadcast("x", ...) / broadcastToOthers(id, "x", ...)
        if (ts.isIdentifier(callee) && /(send|broadcast|notify|push)/i.test(callee.text)) {
          for (const arg of node.arguments) {
            if (arg && ts.isStringLiteral(arg)) push(result.helper, arg.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return result;
}
