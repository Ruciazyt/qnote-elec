import { clipboard, nativeImage, ClipboardItem, type NativeImage } from "electron";

/**
 * 剪贴板图片读写适配层
 *
 * Electron 45 起剪贴板换成了异步的 ClipboardItem API（W3C 异步剪贴板模型）：
 *   - readText / writeText / read / write 全部返回 Promise
 *   - readImage / writeImage 被删掉，图片要走 mime + Blob 自己取
 *   - nativeImage.createFromBlob 也被删掉，Blob 只能先转成 Buffer
 *
 * 所以这里把「图片 ↔ 系统剪贴板」的转换收在一处，调用方只管拿 NativeImage。
 */

/**
 * 从系统剪贴板读一张图片。
 *
 * 剪贴板里的图片 mime 不固定（PNG / JPEG / BMP 都可能），所以按 image/ 前缀找，
 * 找到第一个就用。剪贴板里没有图片时返回空的 NativeImage —— 调用方用 isEmpty() 判断。
 */
export async function readClipboardImage(): Promise<NativeImage> {
  const items = await clipboard.read();

  for (const item of items) {
    const mimeType = item.types.find((type) => type.startsWith("image/"));
    if (!mimeType) continue;

    const payload = await item.getType(mimeType);
    // getType 除了 Blob 还可能返回 ClipboardBookmark（书签），这里只认 Blob
    if (!(payload instanceof Blob)) continue;

    const buffer = Buffer.from(await payload.arrayBuffer());
    return nativeImage.createFromBuffer(buffer);
  }

  return nativeImage.createEmpty();
}

/** 把一张图片写进系统剪贴板。 */
export async function writeClipboardImage(image: NativeImage): Promise<void> {
  const png = image.toPNG();

  await clipboard.write([
    new ClipboardItem({
      "image/png": new Blob([Uint8Array.from(png)], { type: "image/png" }),
    }),
  ]);
}
