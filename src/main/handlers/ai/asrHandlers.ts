import { ipcMain, IpcMainInvokeEvent } from "electron";
import { AsrError, transcribePcm } from "../../core/ai/asr";
import { log } from "../../core/system/log";

const MAX_BASE64_CHARS = 140 * 1024 * 1024;

export function registerAsrHandlers() {
  ipcMain.handle(
    "asr:transcribe",
    async (_event: IpcMainInvokeEvent, pcmBase64: string, sampleRate: number) => {
      try {
        if (typeof pcmBase64 !== "string" || !pcmBase64.length) {
          throw new AsrError("没有收到音频数据");
        }
        if (pcmBase64.length > MAX_BASE64_CHARS) {
          throw new AsrError("录音数据过大，请缩短录音时长");
        }
        if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
          throw new AsrError("采样率无效");
        }

        const bytes = Buffer.from(pcmBase64, "base64");
        if (bytes.length === 0) {
          throw new AsrError("音频数据解码后为空");
        }
        if (bytes.length % 2 !== 0) {
          throw new AsrError("音频数据损坏（字节数不是偶数）");
        }

        const arrayBuffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        );
        const samples = new Int16Array(arrayBuffer);

        const result = await transcribePcm(samples, sampleRate);
        return { ok: true, text: result.text, duration: result.duration };
      } catch (err) {
        if (err instanceof AsrError) {
          return { ok: false, error: err.message };
        }
        const message = err instanceof Error ? err.message : String(err);
        log.error("[asr] IPC 处理失败", err);
        return { ok: false, error: `语音识别失败：${message}` };
      }
    }
  );
}
