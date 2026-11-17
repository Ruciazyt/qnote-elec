
import { log } from "../system/log";
import { configManager } from "../system/config";

const DEFAULT_ASR_BASE = "https://api.minimax.cn";
const ASR_MODEL = "asr-1.0";
export const ASR_MAX_SECONDS = 500;
const ASR_MAX_BYTES = 50 * 1024 * 1024;

export class AsrError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "AsrError";
    this.status = status;
    this.code = code;
  }
}

export function resolveAsrEndpoint(baseUrl: string | undefined): string {
  const trimmed = (baseUrl || "").trim().replace(/^((?:[\s\S]*[^/])?)\/+$/, "$1");

  if (trimmed.endsWith("/speech_to_text")) return trimmed;

  let origin: string;
  try {
    const parsed = new URL(trimmed || DEFAULT_ASR_BASE);
    origin =
      parsed.protocol === "http:" || parsed.protocol === "https:"
        ? parsed.origin
        : new URL(DEFAULT_ASR_BASE).origin;
  } catch {
    origin = new URL(DEFAULT_ASR_BASE).origin;
  }

  return `${origin}/v1/speech_to_text`;
}

export function pcm16ToWav(pcm: Int16Array, sampleRate: number, channels = 1): Buffer {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length * bytesPerSample;

  const out = Buffer.allocUnsafe(44 + dataSize);

  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataSize, 4);
  out.write("WAVE", 8, "ascii");

  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(byteRate, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(16, 34);

  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < pcm.length; i++) {
    out.writeInt16LE(pcm[i], 44 + i * bytesPerSample);
  }
  return out;
}

export interface TranscribeResult {
  text: string;
  duration: number;
  traceId?: string;
}

export async function transcribePcm(
  pcm: Int16Array,
  sampleRate: number,
  signal?: AbortSignal
): Promise<TranscribeResult> {
  const config = await configManager.getAiConfig();
  if (!config.apiKey || !config.apiKey.trim()) {
    throw new AsrError("请先在设置中配置 AI API Key");
  }

  const wav = pcm16ToWav(pcm, sampleRate);

  const seconds = pcm.length / sampleRate;
  if (seconds > ASR_MAX_SECONDS) {
    throw new AsrError(`单次语音输入最长 ${ASR_MAX_SECONDS} 秒，本次约 ${Math.round(seconds)} 秒`);
  }
  if (wav.length > ASR_MAX_BYTES) {
    throw new AsrError("录音体积超过 50MB 上限，请缩短录音时长");
  }

  const endpoint = resolveAsrEndpoint(config.baseUrl);

  const form = new FormData();
  form.append("model", ASR_MODEL);
  form.append("response_format", "json");
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "voice.wav");

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    log.error("[asr] 请求失败", { endpoint, reason });
    throw new AsrError(`语音识别请求失败：${reason}`);
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    log.error("[asr] 接口返回错误", { endpoint, status: response.status, ...detail });
    throw new AsrError(detail.message, response.status, detail.type);
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new AsrError("语音识别返回了无法解析的结果");
  }

  const text = typeof payload?.text === "string" ? payload.text : "";
  log.info("[asr] 识别完成", {
    endpoint,
    seconds: Number(seconds.toFixed(2)),
    chars: text.length,
    elapsedMs: Date.now() - startedAt,
    traceId: payload?.trace_id,
  });

  return {
    text,
    duration: typeof payload?.duration === "number" ? payload.duration : seconds,
    traceId: typeof payload?.trace_id === "string" ? payload.trace_id : undefined,
  };
}

async function readErrorDetail(response: Response): Promise<{ message: string; type?: string }> {
  const fallback = `语音识别失败（HTTP ${response.status}）`;
  try {
    const body: any = await response.json();
    const detail = body?.error;
    const message = typeof detail?.message === "string" && detail.message.trim()
      ? detail.message
      : fallback;
    return { message, type: typeof detail?.type === "string" ? detail.type : undefined };
  } catch {
    return { message: fallback };
  }
}
