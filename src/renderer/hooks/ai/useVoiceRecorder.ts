import { useCallback, useEffect, useRef, useState } from "react";


export type VoiceRecorderStatus =
  | "idle"
  | "starting"
  | "recording"
  | "processing"
  | "error";

export interface VoiceClip {
  pcmBase64: string;
  sampleRate: number;
  seconds: number;
}

const TARGET_SAMPLE_RATE = 16000;

export const MAX_RECORDING_SECONDS = 120;

const MIN_RECORDING_SECONDS = 0.35;

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

class RecorderSession {
  stream: MediaStream | null = null;
  recorder: MediaRecorder | null = null;
  chunks: BlobPart[] = [];
  audioContext: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  rafId: number | null = null;
  maxTimer: ReturnType<typeof setTimeout> | null = null;
  startedAt = 0;
  released = false;

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

let activeSession: RecorderSession | null = null;

export function isRecordingNow(): boolean {
  return activeSession !== null;
}

export function audioBufferToPcm16(buffer: AudioBuffer): Int16Array {
  const channels = buffer.numberOfChannels;
  const sourceLength = buffer.length;
  const sourceRate = buffer.sampleRate;

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

  const pcm = new Int16Array(resampled.length);
  for (let i = 0; i < resampled.length; i++) {
    const sample = Math.max(-1, Math.min(1, resampled[i] ?? 0));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

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
  level: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<VoiceClip | null>;
  cancel: () => void;
  clearError: () => void;
}

export function useVoiceRecorder(): UseVoiceRecorder {
  const [status, setStatus] = useState<VoiceRecorderStatus>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<RecorderSession | null>(null);
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
    } catch {
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
    session.recorder.onerror = () => {
    };

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
      session.analyser = null;
    }

    session.startedAt = Date.now();
    sessionRef.current = session;
    activeSession = session;

    try {
      session.recorder.start();
    } catch {
      teardown();
      setError("无法启动录音");
      setStatus("error");
      return;
    }

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

    if (session.released) {
      sessionRef.current = null;
      if (mountedRef.current) {
        setLevel(0);
        setStatus("idle");
      }
      return null;
    }

    const elapsed = (Date.now() - session.startedAt) / 1000;

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

    if (!mountedRef.current) return null;

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
      console.error("录音解码失败:", err);
      session.release();
      if (!mountedRef.current) return null;
      setError("录音解码失败，请重试");
      setStatus("error");
      return null;
    }
  }, []);

  return { status, level, error, start, stop, cancel, clearError };
}
