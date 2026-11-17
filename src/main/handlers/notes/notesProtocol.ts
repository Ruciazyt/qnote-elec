import { protocol, net } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import { NoteStore } from "../../core/notes/noteStore";
import { detectNoteType } from "../../../shared/notes/noteTypes";
import { log } from "../../core/system/log";

export const NOTES_PROTOCOL = "qnote-note";

const noteStore = new NoteStore();

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".pdf": "application/pdf",
};

const SERVED_TYPES = new Set(["html", "pdf"]);

export async function serveNoteFile(root: string, relPath: string): Promise<Response> {
  let abs: string;
  try {
    abs = noteStore.resolveForShell(root, relPath);
  } catch {
    return new Response("路径非法", { status: 403 });
  }

  const type = detectNoteType(relPath);
  if (!type || !SERVED_TYPES.has(type)) {
    return new Response("不支持的类型", { status: 403 });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return new Response("文件不存在", { status: 404 });
  }

  return net.fetch(pathToFileURL(abs).toString());
}

export function declareNotesScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: NOTES_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function registerNotesProtocol(
  getRoot: () => Promise<string | null>,
  getExternalRoot?: (id: string) => Promise<string | null>
): void {
  protocol.handle(NOTES_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url);
      const raw = decodeURIComponent(url.pathname).replace(/^\/+/, "");

      if (url.hostname === "ext") {
        if (!getExternalRoot) {
          return new Response("外部文件夹未启用", { status: 404 });
        }
        const slash = raw.indexOf("/");
        const id = slash === -1 ? raw : raw.slice(0, slash);
        const relPath = slash === -1 ? "" : raw.slice(slash + 1);
        if (!relPath) {
          return new Response("缺少路径", { status: 400 });
        }
        const extRoot = await getExternalRoot(id);
        if (!extRoot) {
          return new Response("外部文件夹不存在", { status: 404 });
        }
        return await serveNoteFile(extRoot, relPath);
      }

      const relPath = raw;
      const root = await getRoot();

      if (!root) {
        return new Response("笔记目录未设置", { status: 503 });
      }
      if (!relPath) {
        return new Response("缺少路径", { status: 400 });
      }

      return await serveNoteFile(root, relPath);
    } catch (err) {
      log.error("[notes-protocol] 处理请求失败", err);
      return new Response("内部错误", { status: 500 });
    }
  });

  log.info(`笔记预览协议已注册: ${NOTES_PROTOCOL}://`);
}

export function noteMime(relPath: string): string {
  return MIME_BY_EXT[path.extname(relPath).toLowerCase()] ?? "application/octet-stream";
}

declareNotesScheme();