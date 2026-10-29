import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceRecorder } from "./useVoiceRecorder";

/**
 * useVoiceInput — 「说一段话 → 拿到文本」的完整动作
 *
 * 把 useVoiceRecorder（采集/转码）和 ASR 请求串成一次切换式交互，
 * 让对话框里的麦克风按钮和宠物语音气泡共用同一套语义：
 *
 *   空闲 → toggle → 开始录音（显示电平）
 *   录音中 → toggle → 停止 → 识别中 → 拿到文本 → 交给调用方
 *
 * 用户明确选择「两处统一切换式」，所以这里不提供按住说话：
 * 全局快捷键在 Electron 里拿不到按键松开事件（globalShortcut 不上报 keyup），
 * 若输入框用按住说话、快捷键用切换，两套手感并存反而更容易记错。
 */

export type VoiceInputPhase =
  | "idle"
  | "starting"
  | "recording"
  /** 已停止录音，正在解码 + 请求识别 */
  | "transcribing"
  | "error";

export interface UseVoiceInputOptions {
  /**
   * 识别成功后调用。
   * @param text 识别出的文本
   * @returns 可以是 Promise —— 内部会等待它，用于「识别完直接发消息」这类串行动作
   */
  onTranscribed?: (text: string) => void | Promise<void>;
}

export interface UseVoiceInput {
  phase: VoiceInputPhase;
  /** 是否正在录音 */
  isRecording: boolean;
  /** 是否正在识别（解码 + 网络） */
  isTranscribing: boolean;
  /** 麦克风电平 0~1 */
  level: number;
  /** 最近一次错误 */
  error: string | null;
  clearError: () => void;
  /** 切换录音状态；录音中时为"结束并识别" */
  toggle: () => Promise<void>;
  /** 放弃当前这次录音 */
  cancel: () => void;
  /** 最近一次识别出的文本，便于在气泡上回显"你说：…" */
  transcript: string;
}

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInput {
  const recorder = useVoiceRecorder();
  const [requesting, setRequesting] = useState(false);
  const [transcript, setTranscript] = useState("");
  /**
   * 识别阶段的错误单独存 —— useVoiceRecorder 只负责采集/转码，
   * 网络请求的错误无处安放。没有它的话 catch 里抛出的信息就彻底丢了，
   * 界面上表现为"点了没反应"。
   */
  const [requestError, setRequestError] = useState<string | null>(null);

  // 用 ref 持有回调：把它放进依赖会让每次父组件重渲染都重建 toggle，
  // 而 toggle 会被塞进快捷键监听里，容易造成重复订阅。
  const onTranscribedRef = useRef(options.onTranscribed);
  useEffect(() => {
    onTranscribedRef.current = options.onTranscribed;
  }, [options.onTranscribed]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (requesting) return;
    setRequestError(null);

    // 正在录音 → 结束并识别
    if (recorder.status === "recording" || recorder.status === "starting") {
      const clip = await recorder.stop();
      if (!clip) return; // 太短 / 被取消，useVoiceRecorder 已经处理了状态

      setRequesting(true);
      try {
        const response = await window.electron.transcribeVoiceAudio(
          clip.pcmBase64,
          clip.sampleRate
        );

        if (!mountedRef.current) return;

        if (!response?.ok) {
          throw new Error(response?.error || "语音识别失败");
        }

        const text = (response.text || "").trim();
        if (!text) {
          // 识别成功但没有内容 —— 多半是环境噪音。给出明确说明，
          // 否则界面会停在"没反应"的状态，让人以为是按钮坏了。
          throw new Error("没有识别到语音内容，请靠近麦克风再试一次");
        }

        setTranscript(text);
        await onTranscribedRef.current?.(text);
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setRequestError(message);
        console.error("[voice] 识别失败:", message);
      } finally {
        if (mountedRef.current) setRequesting(false);
      }
      return;
    }

    // 空闲 → 开始录音
    setTranscript("");
    recorder.clearError();
    await recorder.start();
  }, [recorder, requesting]);

  const cancel = useCallback(() => {
    setRequesting(false);
    setRequestError(null);
    setTranscript("");
    recorder.cancel();
  }, [recorder]);

  const clearError = useCallback(() => {
    setRequestError(null);
    recorder.clearError();
  }, [recorder]);

  const isRecording = recorder.status === "recording";
  const isTranscribing = recorder.status === "processing" || requesting;

  const phase: VoiceInputPhase = recorder.status === "error" || requestError
    ? "error"
    : isTranscribing
      ? "transcribing"
      : isRecording
        ? "recording"
        : recorder.status === "starting"
          ? "starting"
          : "idle";

  return {
    phase,
    isRecording,
    isTranscribing,
    level: recorder.level,
    // 采集错误与网络错误合并成单一出口，上层只判断这一个字段
    error: recorder.error ?? requestError,
    clearError,
    toggle,
    cancel,
    transcript,
  };
}
