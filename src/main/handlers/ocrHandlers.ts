import { ipcMain, clipboard, nativeImage } from "electron";
import { baiduOcrImage, baiduOcrAccurate, baiduOcrWebImage } from "../utils/baiduOCR";
import { markClipboardSelfWriteImage } from "../core/clipboardListener";
import { log } from "../utils/log";

export function registerOcrHandlers(DB: any) {
  ipcMain.handle("baidu-ocr", async (_event, imageBase64: string) => {
    return await baiduOcrImage(imageBase64);
  });

  ipcMain.handle("baidu-ocr-accurate", async (_event, imageBase64: string) => {
    return await baiduOcrAccurate(imageBase64);
  });

  ipcMain.handle("baidu-ocr-webimage", async (_event, imageUrl: string) => {
    return await baiduOcrWebImage(imageUrl);
  });

  ipcMain.handle("copy-image-to-clipboard", async (_event, imageDataUrl: string) => {
    try {
      // 将 data URL 转换为 NativeImage
      const image = nativeImage.createFromDataURL(imageDataUrl);

      // 登记「这张图是本应用写进去的」——必须赶在写入之前，
      // 否则监听器下一轮看到的就是一条新的图片历史记录。
      markClipboardSelfWriteImage(image);

      // 写入剪贴板
      clipboard.writeImage(image);

      return true;
    } catch (err) {
      log.error("复制图片到剪贴板失败", err);
      return false;
    }
  });

  ipcMain.handle("save-ocr-result", async (event, noteId: number, ocrResult: string) => {
    try {
      await DB.from("note")
        .where("id", noteId)
        .update({ ocr_result: ocrResult, updated_at: new Date() });
      return true;
    } catch (error) {
      log.error("保存OCR结果失败", error);
      return false;
    }
  });
}

