/**
 * MiniMax 语音识别（ASR）客户端
 *
 * 接口契约（https://platform.minimax.cn/docs/api-reference/speech-to-text）：
 *   POST https://api.minimax.cn/v1/speech_to_text
 *   Authorization: Bearer <api_key>
 *   Content-Type: multipart/form-data
 *     · model            必填，当前唯一取值 asr-1.0
 *     · file             必填，音频二进制
 *     · response_format  json（默认）/ verbose_json / srt / vtt
 *     · stream           默认 false
 *   可选请求头 language：BCP-47 标签，留空 = 混合语言识别
 *   响应 200：{ text, duration, trace_id }
 *   响应错误：HTTP 状态码即真实错误码，body = { type:"error", error:{ type, message }, request_id }
 *
 * ## 为什么凭据复用「AI 助手」那把 Key，但不共用它的端点
 *
 * MiniMax 的对话与语音识别是同一账户下的同一把 API Key，用户明确选择了复用，
 * 所以这里不引入第二份配置。
 *
 * 端点只沿用 baseUrl 的 **origin（协议 + 域名）**，路径一律丢掉重拼。原因见
 * resolveAsrEndpoint 的注释 —— 简短版：ASR 端点是固定的，而 baseUrl 的路径由
 * 用户选的 provider 决定，两者没有推导关系，硬拼必然拼错。
 *
 * ## 为什么自己封 WAV，而不是直接上传 MediaRecorder 的产物
 *
 * MediaRecorder 在 Chromium 里只产出 webm/ogg（Opus 编码），而 MiniMax ASR
 * 明确不接受 webm 容器（官方格式白名单：wav/aiff/flac/m4a/mp3/aac/opus/ogg，
 * 且明确写了"不支持无容器的裸 PCM"）。所以渲染层把 webm 解码成 PCM，
 * 主进程在这里补上 WAV 容器 —— WAV 是本接口唯一"包一层头就能用"的格式，
 * 没有编码器依赖，也就不用引入 lame/ffmpeg 之类的原生模块。
 *
 * 官方还建议"单声道 16 kHz"，既省体积又不损识别率，所以渲染层按 16 kHz 送上来。
 */

import { log } from "./log";
import { configManager } from "./config";

/** 未配置 AI 端点时使用官方 ASR 域名 */
const DEFAULT_ASR_BASE = "https://api.minimax.cn";
/** 当前公开的 ASR 模型版本 */
const ASR_MODEL = "asr-1.0";
/** 官方单次时长上限（秒）。超出会返回 400，不会被截断。 */
export const ASR_MAX_SECONDS = 500;
/** 官方单次体积上限（MB） */
const ASR_MAX_BYTES = 50 * 1024 * 1024;

/** ASR 错误 —— 带 HTTP 状态码与官方错误类型，便于 UI 区分「没配 Key」和「余额不足」 */
export class AsrError extends Error {
  readonly status?: number;
  /** 官方错误类型，如 authorized_error / insufficient_balance_error */
  readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "AsrError";
    this.status = status;
    this.code = code;
  }
}

/**
 * 从「AI 助手」的 baseUrl 推导 ASR 端点：**只取 origin，路径一律重拼**。
 *
 *   https://api.minimax.cn/anthropic           → https://api.minimax.cn/v1/speech_to_text
 *   https://api.minimax.cn/v1/chat/completions → https://api.minimax.cn/v1/speech_to_text
 *   https://api.minimaxi.com                   → https://api.minimaxi.com/v1/speech_to_text
 *   https://x/v1/speech_to_text                → 原样返回（幂等，允许显式指定）
 *   空 / 不是合法 URL                          → 官方默认域名
 *
 * ## 为什么必须丢掉路径
 *
 * 之前的实现是在 baseUrl 后面"接一段路径"，只对三种形态做了特判（裸根 / 以 /v1
 * 结尾 / 以 /chat/completions 结尾）。但 baseUrl 的路径形态由用户选的 provider
 * 决定，而项目对 Claude 走的是 `https://api.minimax.cn/anthropic` 这种兼容端点，
 * 不落在任何一种特判里 → 兜底拼出 `https://api.minimax.cn/anthropic/v1/speech_to_text`
 * → **HTTP 404**（实测 2026-10-16，报错日志里就是这个地址）。
 *
 * ASR 端点是 MiniMax 固定的一个地址，与对话端点没有任何推导关系，所以正确做法
 * 是只认域名：既覆盖国内/国际站切换，又不会被 provider 的路径前缀带偏。
 */
export function resolveAsrEndpoint(baseUrl: string | undefined): string {
  const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");

  // 用户显式填了完整 ASR 地址：原样使用，不做任何改写
  if (trimmed.endsWith("/speech_to_text")) return trimmed;

  let origin: string;
  try {
    const parsed = new URL(trimmed || DEFAULT_ASR_BASE);
    // 只接受 http(s)。像 "localhost:8080" 这种会被 new URL 当成
    // protocol=localhost:、origin="null"，拼出来是 "null/v1/speech_to_text"。
    origin =
      parsed.protocol === "http:" || parsed.protocol === "https:"
        ? parsed.origin
        : new URL(DEFAULT_ASR_BASE).origin;
  } catch {
    // baseUrl 写成裸域名（"api.minimax.cn"）之类，解析不了就用官方域名
    origin = new URL(DEFAULT_ASR_BASE).origin;
  }

  return `${origin}/v1/speech_to_text`;
}

/**
 * Int16 PCM → WAV（RIFF/WAVE，16 bit PCM）
 *
 * 手写 44 字节头而不是引第三方库：格式是死的 11 个字段，
 * 换来的代价是一条原生模块编译链，对这个场景完全不划算。
 *
 * @param pcm        交错采样的 Int16 数据
 * @param sampleRate 采样率（Hz）
 * @param channels   声道数
 */
export function pcm16ToWav(pcm: Int16Array, sampleRate: number, channels = 1): Buffer {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length * bytesPerSample;

  // RIFF 的长度字段是 uint32；dataSize 超过 4GB 才会溢出，
  // 而官方 50MB 上限远在此之前，这里不再做无意义的前置检查。
  const out = Buffer.allocUnsafe(44 + dataSize);

  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataSize, 4); // ChunkSize = 文件总长 - 8
  out.write("WAVE", 8, "ascii");

  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16); // fmt 子块长度（固定 16）
  out.writeUInt16LE(1, 20); // audioFormat = 1 → 未压缩 PCM
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(byteRate, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(16, 34); // bitsPerSample

  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataSize, 40);

  // 采样本体：小端 Int16，逐样本写回
  for (let i = 0; i < pcm.length; i++) {
    out.writeInt16LE(pcm[i], 44 + i * bytesPerSample);
  }
  return out;
}

export interface TranscribeResult {
  /** 识别出的完整文本 */
  text: string;
  /** 音频时长（秒），由服务端返回 */
  duration: number;
  /** 官方追踪 ID，排查问题时需要 */
  traceId?: string;
}

/**
 * 把一段 PCM 送去识别，返回完整文本。
 *
 * 刻意用非流式（stream 默认 false）：音频是**录完之后**才整段上传的，
 * 流式只能在服务端处理期间提前吐出文本，而我们并不会把「识别中的半截文本」
 * 展示给任何地方 —— 宠物气泡显示的是 AI 的回复，不是转写结果。
 * 为一个用不上的收益引入 SSE 解析和半成品状态机不值得。
 *
 * @param pcm        渲染层送来的 Int16 单声道 PCM
 * @param sampleRate 采样率
 * @param signal     取消信号
 */
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

  // 前置体积/时长校验：官方会分别返回 413 / 400。与其花一次往返拿一个
  // 英文错误，不如在本地给出能直接照做的中文提示。
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
  // 文件名给 .wav，让服务端按容器嗅探；type 也一并声明。
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "voice.wav");

  const startedAt = Date.now();
  let response: Response;
  try {
    // 注意不要手工设置 Content-Type —— boundary 必须由 fetch 自己生成，
    // 手写会让服务端解析不出 multipart 分隔符，报 400 且原因难懂。
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
  } catch (err) {
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

/**
 * 解析官方错误信封：{ type:"error", error:{ type, message }, request_id }
 *
 * 官方把真实原因放在 error.message 里（末尾括号内是内部错误码），
 * 直接透传给用户比映射成一句「识别失败」有用得多。
 */
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
