import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";


const here = path.dirname(fileURLToPath(import.meta.url));

export const ELECTRON_DTS_PATH = path.resolve(here, "../electron.d.ts");
export const PRELOAD_PATH = path.resolve(here, "../../main/preload.ts");
export const RENDERER_ROOT = path.resolve(here, "..");
export const MAIN_ROOT = path.resolve(here, "../../main");

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function createSourceFile(filePath: string, text: string): ts.SourceFile {
  return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function memberName(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

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

export interface ContractDiff {
  exposedButNotDeclared: string[];
  declaredButNotExposed: string[];
  allowed: Set<string>;
  usagesOutsideContract: string[];
}

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

let allowedCache: Set<string> | null = null;

export function readAllowedApiNames(): Set<string> {
  if (!allowedCache) {
    const { declared, exposed } = readApiNames();
    const exposedSet = new Set(exposed);
    allowedCache = new Set(declared.filter((name) => exposedSet.has(name)));
  }
  return allowedCache;
}

export function readContract() {
  const { declared, exposed } = readApiNames();
  const usages = parseRendererApiUsages();

  return { declared, exposed, usages, ...compareContract({ declared, exposed, usages }) };
}


export interface PreloadChannels {
  invoke: string[];
  send: string[];
  listen: string[];
  dynamic: { api: string; kind: "invoke" | "send" | "on" }[];
}

export interface MainChannels {
  handled: string[];
  listened: string[];
  files: string[];
  unresolved: { file: string; kind: string }[];
}

const IPC_RENDERER_METHODS = new Set(["invoke", "send", "on"]);

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


export interface MainSendChannels {
  direct: string[];
  helper: string[];
  files: string[];
}

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
