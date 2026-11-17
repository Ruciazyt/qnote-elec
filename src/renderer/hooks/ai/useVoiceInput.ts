import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceRecorder } from "./useVoiceRecorder";


export type VoiceInputPhase =
  | "idle"
  | "starting"
  | "recording"
  | "transcribing"
  | "error";

export interface UseVoiceInputOptions {
  onTranscribed?: (text: string) => void | Promise<void>;
}

export interface UseVoiceInput {
  phase: VoiceInputPhase;
  isRecording: boolean;
  isTranscribing: boolean;
  level: number;
  error: string | null;
  clearError: () => void;
  toggle: () => Promise<void>;
  cancel: () => void;
  transcript: string;
}

export function useVoiceInput(options: UseVoiceInputOptions = {}): UseVoiceInput {
  const recorder = useVoiceRecorder();
  const [requesting, setRequesting] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);

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

    if (recorder.status === "recording" || recorder.status === "starting") {
      const clip = await recorder.stop();
      if (!clip) return;

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
    error: recorder.error ?? requestError,
    clearError,
    toggle,
    cancel,
    transcript,
  };
}
