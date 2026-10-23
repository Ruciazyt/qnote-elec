import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useVoiceRecorder — 麦克风录音 → 16 kHz 单声道 Int16 PCM
 *
 * ## 为什么录完还要转码
 *
 * Chromium 的 MediaRecorder 只会产出 webm / ogg（Opus 编码），而 MiniMax ASR
 * 的格式白名单是 wav / aiff / flac / m4a / mp3 / aac / opus / ogg ——
 * **没有 webm**。所以必须在这里把 webm 解回 PCM，交给主进程封成 WAV 上传。
 *
 * 为什么统一降到 16 kHz 单声道：官方文档明确建议「转为单声道 16 kHz，
 * 或改用 mp3/aac/opus 等压缩格式，识别结果不受影响」。顺带把体积压到
 * 32 KB/秒 —— 10 秒录音才 320 KB，过桥的 base64 也才 430 KB。
 *
 * ## 单实例约束
 *
 * 麦克风是独占资源。输入框的麦克风按钮和宠物语音气泡会同时挂载，
 * 所以这里用模块级 activeSession 保证同一时刻只有一段录音在跑，
 * 后启动的会先叫停前一个（切换式录音下这正是用户期待的行为：
 * 在气泡处点一下开始、在输入框点一下开始，应当是把录音"接管"过去）。
 */

export type VoiceRecorderStatus =
  | "idle"
  /** 正在申请麦克风权限 / 建立 AudioContext */
  | "starting"
  | "recording"
  /** 录音已停，正在解码与转码 */
  | "processing"
  | "error";

/** 送往上层的录音结果 */
export interface VoiceClip {
  /** Int16 单声道 PCM 的 base64 */
  pcmBase64: string;
  /** 固定 16000 */
  sampleRate: number;
  /** 录音时长（秒） */
  seconds: number;
}

/** 上传目标采样率。官方建议单声道 16 kHz */
const TARGET_SAMPLE_RATE = 16000;

/**
 * 单次录音上限（秒）
 *
 * 官方接口的硬上限是 500 秒，但一段按 16 kHz 计就有 16 MB，
 * 更重要的是 8 分钟的"语音输入"在交互上毫无意义。
 * 取 120 秒：足够说完一段话，又远在体积与时长限制之内。
 */
export const MAX_RECORDING_SECONDS = 120;

/** 短于此值视为"没说什么"，直接丢弃不发请求 */
const MIN_RECORDING_SECONDS = 0.35;

/** 优先使用容器/编码兼容性最好的类型；都不支持时交给浏览器默认 */
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const type of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return undefined;
}

/**
 * 一次实际录音所持有的资源。
 *
 * 单独抽成类而不是散在 hook 的闭包里，是因为它必须在**调用方的 effect 之外**
 * 也能被访问：模块级 activeSession 要能叫停别的实例正在跑的录音，
 * 那时拿不到对方的 setState。
 */
class RecorderSession {
  stream: MediaStream | null = null;
  recorder: MediaRecorder | null = null;
  chunks: BlobPart[] = [];
  audioContext: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  rafId: number | null = null;
  maxTimer: ReturnType<typeof setTimeout> | null = null;
  startedAt = 0;
  /**
   * 已被 release() 关闭。
   *
   * 录音可以在「另一个组件实例」那里被接管（全局快捷键按下时，
   * 宠物气泡会抢走输入框正在进行的录音）。被抢走的那个实例仍然持有
   * sessionRef，若不检查这个标记，它的 stop() 就会去操作一条已经
   * 停掉的麦克风轨道 —— 拿到空数据、状态永远卡在 recording。
   */
  released = false;

  /** 关闭麦克风轨道并停掉电平轮询 */
  release(): void {
    if (this.released) return;
    this.released = true;
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.analyser = null;
    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close().catch(() => undefined);
    }
    this.audioContext = null;
  }
}

/** 当前正在录音的会话；同一时刻只允许一个 */
let activeSession: RecorderSession | null = null;

export function isRecordingNow(): boolean {
  return activeSession !== null;
}

/**
 * AudioBuffer → 16 kHz 单声道 Int16
 *
 * 不直接依赖 `new OfflineAudioContext(1, 1, 16000)` 把解码结果降到 16 kHz：
 * 各浏览器对 decodeAudioData 是否跟随上下文采样率重采样并不一致。
 * 显式自己做一遍重采样，只依赖规范明确保证的行为。
 *
 * 导出是为了能被 scripts/ 下的验证脚本直接调用 —— 这段插值和下混
 * 是整条链路里最容易写错又最难靠肉眼发现的部分。
 */
export function audioBufferToPcm16(buffer: AudioBuffer): Int16Array {
  const channels = buffer.numberOfChannels;
  const sourceLength = buffer.length;
  const sourceRate = buffer.sampleRate;

  // ① 多声道下混为单声道（各声道等权平均）
  let mono: Float32Array;
  if (channels === 1) {
    mono = new Float32Array(buffer.getChannelData(0));
  } else {
    mono = new Float32Array(sourceLength);
    for (let channel = 0; channel < channels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < sourceLength; i++) {
        mono[i] += data[i];
      }
    }
    const invChannels = 1 / channels;
    for (let i = 0; i < sourceLength; i++) {
      mono[i] *= invChannels;
    }
  }

  // ② 线性插值重采样到 16 kHz（已经是目标采样率就跳过）
  let resampled = mono;
  if (sourceRate !== TARGET_SAMPLE_RATE && sourceRate > 0) {
    const ratio = sourceRate / TARGET_SAMPLE_RATE;
    const outLength = Math.max(1, Math.floor(sourceLength / ratio));
    resampled = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const frac = position - index;
      const current = mono[index] ?? 0;
      const next = index + 1 < sourceLength ? mono[index + 1] : current;
      resampled[i] = current + (next - current) * frac;
    }
  }

  // ③ Float32 [-1, 1] → Int16
  const pcm = new Int16Array(resampled.length);
  for (let i = 0; i < resampled.length; i++) {
    const sample = Math.max(-1, Math.min(1, resampled[i] ?? 0));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

/**
 * Int16Array → base64
 *
 * 走 base64 而不是直接传 Uint8Array，是因为 contextBridge 不保证 TypedArray
 * 原样送达主进程（会被拆成普通对象），而纯字符串不会有这个问题。
 * 分块调用避免一次性 apply 上万个参数爆栈。
 *
 * 导出同样是为了验证脚本能直接检验分块拼接与 btoa 的结果。
 */
export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const CHUNK_SIZE = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export interface UseVoiceRecorder {
  status: VoiceRecorderStatus;
  /** 当前麦克风音量 0~1，用于画波形/呼吸效果 */
  level: number;
  /** 最近一次错误；调用方展示后可调用 clearError */
  error: string | null;
  /** 开始录音 */
  start: () => Promise<void>;
  /** 停止录音并返回音频；过短或被取消时返回 null */
  stop: () => Promise<VoiceClip | null>;
  /** 放弃本次录音 */
  cancel: () => void;
  clearError: () => void;
}

export function useVoiceRecorder(): UseVoiceRecorder {
  const [status, setStatus] = useState<VoiceRecorderStatus>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<RecorderSession | null>(null);
  // 挂载标记：防止组件已卸载还去 setState（录音停止是异步的，很容易撞上）
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session && activeSession === session) {
        activeSession = null;
      }
      session?.release();
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const teardown = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session && activeSession === session) {
      activeSession = null;
    }
    session?.release();
    if (mountedRef.current) setLevel(0);
  }, []);

  /** 轮询 AnalyserNode 算 RMS 电平，驱动 UI 的呼吸/波形反馈 */
  const startLevelMeter = useCallback((session: RecorderSession) => {
    const analyser = session.analyser;
    const audioContext = session.audioContext;
    if (!analyser || !audioContext) return;

    const data = new Uint8Array(analyser.fftSize);

    const tick = () => {
      if (sessionRef.current !== session) return;
      analyser.getByteTimeDomainData(data);

      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      // 人声的 RMS 大多在 0.02~0.3，线性映射到 0~1 会几乎贴地；
      // 取 sqrt 提升低音量段的区分度，再夹到 1
      const visual = Math.min(1, Math.sqrt(rms) * 1.8);

      if (mountedRef.current) setLevel(visual);
      session.rafId = requestAnimationFrame(tick);
    };

    session.rafId = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("当前环境不支持录音");
      setStatus("error");
      return;
    }

    setStatus("starting");
    setError(null);

    // 接管式切换：先把上一个实例的录音停掉，再开新的
    if (activeSession) {
      const previous = activeSession;
      activeSession = null;
      previous.release();
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      let message = "无法访问麦克风";
      if (name === "NotAllowedError" || name === "SecurityError") {
        message = "麦克风权限被拒绝，请在系统设置中允许 QNote 使用麦克风";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        message = "没有找到可用的麦克风设备";
      } else if (name === "NotReadableError") {
        message = "麦克风被其它程序占用";
      }
      setError(message);
      setStatus("error");
      return;
    }

    // getUserMedia 是异步的，等待期间组件可能已经卸载 / 用户已改主意
    if (!mountedRef.current || sessionRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const session = new RecorderSession();
    session.stream = stream;
    session.chunks = [];

    const mimeType = pickMimeType();
    try {
      session.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      setError("无法启动录音");
      setStatus("error");
      return;
    }

    session.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        session.chunks.push(event.data);
      }
    };
    // 录完的等待由 stop() 自己监听 'stop' 事件完成，这里不需要额外的中转 promise。
    session.recorder.onerror = () => {
      // 出错时把已收到的分片留在 chunks 里，stop() 会用它兜底
    };

    // Web Audio 仅用于电平表；解码走后面独立的 OfflineAudioContext
    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as any).webkitAudioContext;
      if (AudioContextCtor) {
        session.audioContext = new AudioContextCtor();
        const source = session.audioContext.createMediaStreamSource(stream);
        const analyser = session.audioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        session.analyser = analyser;
        startLevelMeter(session);
      }
    } catch {
      // 电平表失败不影响录音本身，静默降级
      session.analyser = null;
    }

    session.startedAt = Date.now();
    sessionRef.current = session;
    activeSession = session;

    try {
      session.recorder.start();
    } catch (err) {
      teardown();
      setError("无法启动录音");
      setStatus("error");
      return;
    }

    // 到达时长上限自动停止
    session.maxTimer = setTimeout(() => {
      if (sessionRef.current === session && session.recorder?.state === "recording") {
        session.recorder.stop();
      }
    }, MAX_RECORDING_SECONDS * 1000);

    setStatus("recording");
  }, [startLevelMeter, teardown]);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    teardown();
    if (mountedRef.current) setStatus("idle");
  }, [teardown]);

  const stop = useCallback(async (): Promise<VoiceClip | null> => {
    const session = sessionRef.current;
    if (!session) return null;

    // 录音已被别处接管 —— 这边没什么可停的，直接回到空闲。
    // 不做这个判断的话，状态会永远停在 recording，麦克风按钮再也点不动。
    if (session.released) {
      sessionRef.current = null;
      if (mountedRef.current) {
        setLevel(0);
        setStatus("idle");
      }
      return null;
    }

    const elapsed = (Date.now() - session.startedAt) / 1000;

    // 先摘掉引用，让 stop 之后新的一次 start 可以立即开始
    sessionRef.current = null;
    if (activeSession === session) activeSession = null;

    const recorder = session.recorder;
    const blob = await new Promise<Blob>((resolve) => {
      if (!recorder || recorder.state === "inactive") {
        resolve(new Blob(session.chunks));
        return;
      }
      const timer = setTimeout(() => resolve(new Blob(session.chunks)), 3000);
      session.recorder!.addEventListener(
        "stop",
        () => {
          clearTimeout(timer);
          // onstop 里已经 resolve 过 resolveStopped，这里兜底用 chunks 兜底拼一次
          resolve(new Blob(session.chunks, { type: recorder.mimeType || "audio/webm" }));
        },
        { once: true }
      );
      try {
        recorder.stop();
      } catch {
        clearTimeout(timer);
        resolve(new Blob(session.chunks));
      }
    });

    // 注意：解码需要 Web Audio，所以先 release 再解码会拿不到 AudioContext ——
    // 顺序必须是「先解码，再释放」。
    if (!mountedRef.current) return null;

    // 太短 —— 多半是误触，不值得发一次请求
    if (!blob.size || elapsed < MIN_RECORDING_SECONDS) {
      session.release();
      if (mountedRef.current) setStatus("idle");
      return null;
    }

    setStatus("processing");

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const OfflineCtor =
        window.OfflineAudioContext ||
        (window as any).webkitOfflineAudioContext;
      const offline = new OfflineCtor(1, 1, TARGET_SAMPLE_RATE);
      const audioBuffer = await offline.decodeAudioData(arrayBuffer);
      const pcm = audioBufferToPcm16(audioBuffer);
      session.release();

      if (!mountedRef.current) return null;
      if (pcm.length === 0) {
        setError("没有采集到有效声音");
        setStatus("error");
        return null;
      }

      setStatus("idle");
      return {
        pcmBase64: pcmToBase64(pcm),
        sampleRate: TARGET_SAMPLE_RATE,
        seconds: pcm.length / TARGET_SAMPLE_RATE,
      };
    } catch (err) {
      session.release();
      if (!mountedRef.current) return null;
      setError("录音解码失败，请重试");
      setStatus("error");
      return null;
    }
  }, []);

  return { status, level, error, start, stop, cancel, clearError };
}
