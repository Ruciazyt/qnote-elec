import { clipboard, BrowserWindow, NativeImage } from "electron";
import { log } from "../system/log";
import { Knex } from "knex";
import { contentHash } from "../../../shared/notes/noteHash";
import { readClipboardImage } from "../../utils/clipboard";

let lastClipboardText: string = "";
let lastClipboardImageHash: string = "";
let lastUpdateTime: number = 0;
let isProcessing: boolean = false;
const DEBOUNCE_DELAY: number = 300;
let clipboardIntervalId: NodeJS.Timeout | null = null;

const SELF_WRITE_TTL = 15_000;
const selfWrittenTexts = new Map<string, number>();
const selfWrittenImageHashes = new Map<string, number>();

function pruneSelfWrites(store: Map<string, number>): void {
  const now = Date.now();
  for (const [key, expireAt] of store) {
    if (expireAt <= now) store.delete(key);
  }
}

export function markClipboardSelfWrite(content: string): void {
  if (!content) return;
  pruneSelfWrites(selfWrittenTexts);
  selfWrittenTexts.set(normalizedHash(content), Date.now() + SELF_WRITE_TTL);
}

export function markClipboardSelfWriteImage(image: NativeImage): void {
  const fingerprint = imageFingerprint(image);
  if (!fingerprint) return;
  pruneSelfWrites(selfWrittenImageHashes);
  selfWrittenImageHashes.set(fingerprint, Date.now() + SELF_WRITE_TTL);
}

function consumeSelfWrite(content: string): boolean {
  const key = normalizedHash(content);
  const expireAt = selfWrittenTexts.get(key);
  if (expireAt === undefined) return false;
  selfWrittenTexts.delete(key);
  return expireAt > Date.now();
}

function normalizedHash(content: string): string {
  return contentHash(content.replace(/\r\n/g, "\n"));
}

function consumeSelfWriteImage(fingerprint: string): boolean {
  const expireAt = selfWrittenImageHashes.get(fingerprint);
  if (expireAt === undefined) return false;
  selfWrittenImageHashes.delete(fingerprint);
  return expireAt > Date.now();
}

function imageFingerprint(image: NativeImage): string {
  if (image.isEmpty()) return "";

  const { width, height } = image.getSize();
  if (width === 0 || height === 0) return "";

  const bitmap = image.toBitmap();
  if (bitmap.length === 0) return `${width}x${height}:0`;

  const step = Math.max(1, Math.floor(bitmap.length / 4096));
  let h = 0x811c9dc5;
  for (let i = 0; i < bitmap.length; i += step) {
    h ^= bitmap[i];
    h = Math.imul(h, 0x01000193);
  }

  return `${width}x${height}:${(h >>> 0).toString(16)}:${bitmap.length}`;
}

interface ClipboardData {
  id?: number;
  type: "text" | "image";
  content: string;
  time: string;
}

function broadcastClipboardChanged(payload: ClipboardData): void {
  for (const target of BrowserWindow.getAllWindows()) {
    if (target.isDestroyed()) continue;
    try {
      target.webContents.send("clipboard-changed", payload);
    } catch (err) {
      log.warn("[clipboard] 广播剪贴板变更失败", err);
    }
  }
}

export function clipboardListener(win: BrowserWindow, DB: Knex): void {
  log.info("剪贴板监听器启动");
  void win;

  clipboardIntervalId = setInterval(async () => {
    if (isProcessing) {
      return;
    }
    if (Date.now() - lastUpdateTime < DEBOUNCE_DELAY) {
      return;
    }

    try {
      isProcessing = true;
      const text = await clipboard.readText();
      const currentTime = new Date().toISOString();

      if (text && text !== lastClipboardText && text.length > 0) {
        lastClipboardText = text;

        if (consumeSelfWrite(text)) {
          log.info("跳过：本次文本剪贴板变化来自应用内复制");
        } else {
          log.info("检测到新的文本剪贴板内容", { length: text.length });

          const saved = await saveToDatabase(DB, {
            type: "text",
            content: text,
            time: currentTime
          });

          if (saved.saved) {
            broadcastClipboardChanged({
              id: saved.id,
              type: "text",
              content: text,
              time: currentTime,
            } as ClipboardData);
          }
        }
      } else {
        const image = await readClipboardImage();
        const imageHash = imageFingerprint(image);

        if (imageHash && imageHash !== lastClipboardImageHash) {
          if (consumeSelfWriteImage(imageHash)) {
            log.info("跳过：本次图片剪贴板变化来自应用内复制");
            lastClipboardImageHash = imageHash;
          } else {
            const imageDataUrl = image.toDataURL();

            if (imageDataUrl.startsWith("data:image/")) {
              log.info("检测到新的图片剪贴板内容", { size: imageDataUrl.length });
              lastClipboardImageHash = imageHash;

              const saved = await saveToDatabase(DB, {
                type: "image",
                content: imageDataUrl,
                time: currentTime
              });

              if (saved.saved) {
                broadcastClipboardChanged({
                  id: saved.id,
                  type: "image",
                  content: imageDataUrl,
                  time: currentTime,
                } as ClipboardData);
              }
            }
          }
        }
      }
    } catch (err) {
      log.error("剪贴板监听器错误:", err);
    } finally {
      isProcessing = false;
      lastUpdateTime = Date.now();
    }
  }, 2000);
}

export function stopClipboardListener(): void {
  if (clipboardIntervalId !== null) {
    clearInterval(clipboardIntervalId);
    clipboardIntervalId = null;
    selfWrittenTexts.clear();
    selfWrittenImageHashes.clear();
    log.info("剪贴板监听器已停止");
  }
}

async function saveToDatabase(
  DB: Knex,
  data: ClipboardData
): Promise<{ saved: boolean; id?: number }> {
  try {
    log.info("开始保存到数据库", { type: data.type, contentLength: data.content.length });

    const hash = contentHash(data.content);
    const existingRecord = await DB("note")
      .where("content_hash", hash)
      .where("type", data.type)
      .where("content", data.content)
      .first();

    if (existingRecord) {
      log.info("记录已存在，跳过保存", { type: data.type, id: existingRecord.id });
      return { saved: false, id: existingRecord.id };
    }

    const result = await DB("note").insert({
      content: data.content,
      type: data.type,
      content_hash: hash,
      created_at: data.time,
      updated_at: data.time,
    });

    const insertId = Array.isArray(result) ? Number(result[0]) : Number(result);

    log.info("数据库保存成功", { insertId, type: data.type });
    return {
      saved: true,
      id: Number.isFinite(insertId) ? insertId : undefined,
    };
  } catch (err) {
    log.error("数据库保存失败:", err);
    return { saved: false };
  }
}
