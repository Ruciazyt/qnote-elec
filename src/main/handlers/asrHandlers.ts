import { ipcMain, IpcMainInvokeEvent } from "electron";
import { AsrError, transcribePcm } from "../utils/asr";
import { log } from "../utils/log";

/** base64 字符串能安全穿过 contextBridge，TypedArray 不能 —— 详见 transcribeVoice 的注释 */
const MAX_BASE64_CHARS = 140 * 1024 * 1024; // 约 105MB 音频，远超官方 50MB 上限，留足余量

/**
 * 注册语音识别 IPC
 *
 * 音频字节流全部经由这里进出主进程，API Key 从不离开主进程 ——
 * 渲染层只能把「一段录好的 PCM」递进来，拿不到任何凭据。
 */
export function registerAsrHandlers() {
  /**
   * 识别一段录音
   *
   * @param pcmBase64   Int16 单声道 PCM 的 base64（16 kHz）
   * @param sampleRate  采样率
   */
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
          // Int16 必须是偶数字节。出现奇数说明编码链路坏了，
          // 直接报错好过悄悄丢掉最后一个字节、得到一段尾部有杂音的音频。
          throw new AsrError("音频数据损坏（字节数不是偶数）");
        }

        // 复制到全新的 ArrayBuffer 再建视图：
        // Buffer.from(base64) 走的是内存池，byteOffset 未必是 2 的倍数，
        // 直接 new Int16Array(bytes.buffer, bytes.byteOffset, …) 会抛
        // "start offset of Int16Array should be a multiple of 2"。
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
