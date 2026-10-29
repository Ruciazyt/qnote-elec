import { clipboard, BrowserWindow, NativeImage } from "electron";
import { log } from "../utils/log";
import { Knex } from "knex";
import { contentHash } from "../../shared/noteHash";
import { readClipboardImage } from "../utils/clipboard";

let lastClipboardText: string = "";
let lastClipboardImageHash: string = ""; // 使用哈希值而非完整base64
let lastUpdateTime: number = 0;
let isProcessing: boolean = false;
const DEBOUNCE_DELAY: number = 300; // 300ms 的防抖延迟
let clipboardIntervalId: NodeJS.Timeout | null = null;

/**
 * 「应用自己写入剪贴板」的登记
 *
 * 用户在应用里复制东西时，剪贴板内容确实变了，监听器下一轮就会看到它。
 * 照常保存的话，复制一次就在历史里凭空多出一条一模一样的记录。
 * 这里在**写入之前**把内容指纹登记下来，监听器命中就跳过。
 *
 * ## 为什么必须在主进程登记，而不是让渲染层复制完再通知
 *
 * 监听器每 2 秒轮询一次，渲染层写完剪贴板再发 IPC 通知，中间存在一个
 * 监听器已经读到新内容的窗口 —— 那一次就会被记下来。
 * 主进程先登记、再写剪贴板，登记一定早于内容变化，监听器不可能读到
 * 还没登记的新内容（Electron 45 起写剪贴板是异步的，但异步只发生在
 * 登记之后，方向是安全的）。
 *
 * ## 一次性消费
 *
 * 命中后立刻从集合里移除，避免用户从别的程序复制同样的内容时也被误吞。
 * TTL(15s) 只用于兜住「登记了但监听器这一轮没轮到」的情况，远大于
 * 2s 轮询 + 300ms 防抖。
 */
const SELF_WRITE_TTL = 15_000;
const selfWrittenTexts = new Map<string, number>();
const selfWrittenImageHashes = new Map<string, number>();

function pruneSelfWrites(store: Map<string, number>): void {
  const now = Date.now();
  for (const [key, expireAt] of store) {
    if (expireAt <= now) store.delete(key);
  }
}

/** 登记一段文本为「刚由本应用写入」。 */
export function markClipboardSelfWrite(content: string): void {
  if (!content) return;
  pruneSelfWrites(selfWrittenTexts);
  selfWrittenTexts.set(normalizedHash(content), Date.now() + SELF_WRITE_TTL);
}

/** 登记一张图片为「刚由本应用写入」，按指纹而不是 base64，省一次全量哈希。 */
export function markClipboardSelfWriteImage(image: NativeImage): void {
  const fingerprint = imageFingerprint(image);
  if (!fingerprint) return;
  pruneSelfWrites(selfWrittenImageHashes);
  selfWrittenImageHashes.set(fingerprint, Date.now() + SELF_WRITE_TTL);
}

/**
 * 命中即消费：返回 true 表示这条内容是应用自己写进去的，应当跳过记录。
 */
function consumeSelfWrite(content: string): boolean {
  const key = normalizedHash(content);
  const expireAt = selfWrittenTexts.get(key);
  if (expireAt === undefined) return false;
  selfWrittenTexts.delete(key);
  return expireAt > Date.now();
}

/**
 * 登记和比对都走归一化后的指纹。
 *
 * Windows 的剪贴板会把换行规整成 \r\n：渲染层写进去的是原文，
 * 监听器读出来可能是另一种换行，直接比哈希就对不上，抑制会静默失效、
 * 于是这次复制又被记成一条新历史。登记与比对用同一套归一化才能对齐。
 *
 * 只影响这里的"自写登记"，saveToDatabase 的去重仍按原始 content 比较。
 */
function normalizedHash(content: string): string {
  return contentHash(content.replace(/\r\n/g, "\n"));
}

function consumeSelfWriteImage(fingerprint: string): boolean {
  const expireAt = selfWrittenImageHashes.get(fingerprint);
  if (expireAt === undefined) return false;
  selfWrittenImageHashes.delete(fingerprint);
  return expireAt > Date.now();
}

/**
 * 图片指纹：尺寸 + 原始像素抽样哈希
 *
 * ## 为什么不用 toDataURL 来算指纹
 *
 * 原实现每个轮询周期都调 `image.toDataURL()`，那是一次完整的 PNG 编码加
 * base64 展开（体积再涨 1/3）。只要剪贴板里一直躺着一张截图 —— 这是最常见的
 * 情况 —— 每 2 秒就要把整张图重新编码一次，哪怕内容一个字都没变。
 * 4K 截图下这是几十到几百毫秒的纯浪费。
 *
 * ## 这里做了什么
 *
 * 先取原始 BGRA 位图做一次**抽样**哈希（4096 个采样点，O(1) 级别），
 * 指纹没变就直接跳过，连 PNG 编码都不进。只有确实变了才调 toDataURL()。
 * 抽样比全量扫描快几个数量级，而指纹强度依然远高于原来那套"只看 base64
 * 前 10000 字符"的做法。
 */
function imageFingerprint(image: NativeImage): string {
  if (image.isEmpty()) return "";

  const { width, height } = image.getSize();
  if (width === 0 || height === 0) return "";

  const bitmap = image.toBitmap();
  if (bitmap.length === 0) return `${width}x${height}:0`;

  // 跨步抽样，步长保证采样点落在 4096 左右；小图直接全取
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

export function clipboardListener(win: BrowserWindow, DB: Knex): void {
  log.info("剪贴板监听器启动");

  clipboardIntervalId = setInterval(async () => {
    // 如果正在处理中，直接返回；如果在防抖时间内，记录时间但不处理
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

      // 只处理有效的文本或图片
      if (text && text !== lastClipboardText && text.length > 0) {
        // 先更新 lastClipboardText：无论后面记不记录，这一轮都不能再判定为变化
        lastClipboardText = text;

        // 应用内自己复制出来的内容，不再往历史里记一条一模一样的
        if (consumeSelfWrite(text)) {
          log.info("跳过：本次文本剪贴板变化来自应用内复制");
        } else {
          log.info("检测到新的文本剪贴板内容", { length: text.length });

          // 保存到数据库，只有保存成功才发送事件
          const saved = await saveToDatabase(DB, {
            type: "text",
            content: text,
            time: currentTime
          });

          if (saved.saved) {
            // 发送到渲染进程
            win.webContents.send("clipboard-changed", {
              id: saved.id,
              type: "text",
              content: text,
              time: currentTime,
            } as ClipboardData);
          }
        }
      } else {
        // 图片走单独分支：先取指纹判断有没有变，变了才付 PNG 编码的代价
        const image = await readClipboardImage();
        const imageHash = imageFingerprint(image);

        if (imageHash && imageHash !== lastClipboardImageHash) {
          // 应用内复制的图片按指纹就地拦掉，连 PNG 编码都不用付
          if (consumeSelfWriteImage(imageHash)) {
            log.info("跳过：本次图片剪贴板变化来自应用内复制");
            lastClipboardImageHash = imageHash;
          } else {
            const imageDataUrl = image.toDataURL();

            if (imageDataUrl.startsWith("data:image/")) {
              log.info("检测到新的图片剪贴板内容", { size: imageDataUrl.length });
              lastClipboardImageHash = imageHash;

              // 保存到数据库，只有保存成功才发送事件
              const saved = await saveToDatabase(DB, {
                type: "image",
                content: imageDataUrl,
                time: currentTime
              });

              if (saved.saved) {
                win.webContents.send("clipboard-changed", {
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
      lastUpdateTime = Date.now(); // 完成后设置防抖计时器，避免立即重复处理
    }
  }, 2000); // 降低检查频率到2秒，减少CPU使用
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

    // 去重走 content_hash 索引，而不是在 TEXT 上做等值比较。
    // content 里存着图片 base64，直接比等于每次剪贴板事件都全表扫描一遍
    // 历史图片的字节。哈希定长且有索引，只回读命中的那一行。
    // 末尾的 content 全等比较是哈希碰撞的兜底，索引已经收敛到 1 行，
    // 这一下额外比较可以忽略不计。
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
