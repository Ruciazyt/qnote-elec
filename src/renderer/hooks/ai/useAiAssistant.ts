import { useCallback, useEffect, useRef, useState } from "react";
import { AiChatSession, ChatMessage } from "@/pages/ai/types";
import { BlockBuilder, type AssistantBlock } from "@shared/ai/aiBlocks";
import {
  AI_IMAGE_MAX_COUNT,
  type AiImageAttachment,
} from "@shared/ai/aiImages";
import { toast } from "@/hooks/ui/use-toast";
import { randomHex } from "@/utils/system/randomId";

export interface StreamingMessage {
  sessionId: string;
  content: string;
  blocks?: AssistantBlock[];
}

export interface AiSkill {
  id: string;
  name: string;
  content: string;
  isCustom: boolean;
}

export type PetBubblePhase =
  | "listening"
  | "transcribing"
  | "thinking"
  | "streaming"
  | "done"
  | "error";

export interface PetBubbleState {
  phase: PetBubblePhase;
  utterance: string;
  reply: string;
  error?: string;
}

const MAX_PET_AUTO_CONTINUE = 3;

export interface UseAiAssistantOptions {
  onError?: (message: string) => void;
}

export function useAiAssistant(options?: UseAiAssistantOptions) {
  const onErrorRef = useRef<((message: string) => void) | undefined>(options?.onError);

  useEffect(() => {
    onErrorRef.current = options?.onError;
  });

  const [chatSessions, setChatSessions] = useState<AiChatSession[]>([]);
  const [activeChatSession, setActiveChatSession] = useState<AiChatSession | null>(null);
  const [assistantView, setAssistantView] = useState<"sessions" | "chat">("sessions");
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiImages, setAiImages] = useState<AiImageAttachment[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  const [compacting, setCompacting] = useState<{ round: number; maxRounds: number } | null>(null);
  const [pendingContinuation, setPendingContinuation] = useState<{
    sessionId: string;
    rounds: number;
    totalRounds: number;
  } | null>(null);
  const [latestClipboardContent, setLatestClipboardContent] = useState<
    string | undefined
  >(undefined);

  const [skills, setSkills] = useState<AiSkill[]>([]);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const activeSkillIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeSkillIdRef.current = activeSkillId;
  }, [activeSkillId]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const activeChatSessionIdRef = useRef<string | null>(null);
  const historyRequestRef = useRef(0);
  const creatingSessionRef = useRef(false);
  const activeSessionRef = useRef<{
    sessionId: string;
    cleanup: () => void;
  } | null>(null);

  const loadChatSessions = useCallback(async () => {
    try {
      const response = await window.electron.getAiChatSessions();
      if (!Array.isArray(response)) {
        console.error("AI会话列表接口返回了无效结果");
        setChatSessions([]);
        setActiveChatSession(null);
        return [];
      }
      const sessions = response;
      setChatSessions(sessions);
      setActiveChatSession((current) =>
        current ? sessions.find((session) => session.id === current.id) ?? current : null
      );
      return sessions;
    } catch (err) {
      console.error("加载AI会话列表失败", err);
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadChatSessions().finally(() => {
      if (!cancelled) setSessionsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadChatSessions]);

  useEffect(() => {
    const handler = (_event: unknown, record: unknown) => {
      const r = record as { type?: string; content?: string };
      if (r?.type === "text" && typeof r.content === "string") {
        setLatestClipboardContent(r.content);
      }
    };
    window.electron.onClipboardChanged(handler);
    return () => {
      window.electron.removeClipboardChanged(handler);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await window.electron.getAiSkills();
        if (!cancelled && Array.isArray(list)) {
          setSkills(list);
        }
      } catch (err) {
        console.error("加载AI技能失败:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      const active = activeSessionRef.current;
      if (active) {
        try {
          window.electron.cancelAiMessage(active.sessionId);
        } catch {
        }
        active.cleanup();
        activeSessionRef.current = null;
      }
    };
  }, []);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }, []);

  const createChatSession = useCallback(async () => {
    if (creatingSessionRef.current) return null;
    creatingSessionRef.current = true;
    setIsCreatingSession(true);
    const requestId = ++historyRequestRef.current;
    activeChatSessionIdRef.current = null;
    setActiveChatSession(null);
    setChatHistoryLoading(false);
    setChatMessages([]);

    try {
      const session = await window.electron.createAiChatSession();
      if (requestId !== historyRequestRef.current) {
        void loadChatSessions();
        return null;
      }

      activeChatSessionIdRef.current = session.id;
      setActiveChatSession(session);
      setChatSessions((current) => [
        session,
        ...current.filter((item) => item.id !== session.id),
      ]);
      setAssistantView("chat");
      return session;
    } catch (err) {
      console.error("新建AI对话失败", err);
      return null;
    } finally {
      creatingSessionRef.current = false;
      setIsCreatingSession(false);
    }
  }, [loadChatSessions]);

  const addAiImages = useCallback((incoming: AiImageAttachment[]) => {
    if (!incoming || incoming.length === 0) return;
    setAiImages((current) => {
      const next = [...current];
      for (const image of incoming) {
        if (next.length >= AI_IMAGE_MAX_COUNT) break;
        if (next.some((item) => item.data === image.data)) continue;
        next.push(image);
      }
      return next;
    });
  }, []);

  const removeAiImage = useCallback((index: number) => {
    setAiImages((current) => current.filter((_, i) => i !== index));
  }, []);

  const handleSendAiMessage = useCallback(async () => {
    const text = aiInput.trim();
    if ((!text && aiImages.length === 0) || aiLoading) return;

    let chatSessionId = activeChatSessionIdRef.current;
    if (!chatSessionId && assistantView === "sessions") {
      const session = await createChatSession();
      if (!session) return;
      chatSessionId = session.id;
    }
    if (!chatSessionId) return;

    if (activeSessionRef.current) {
      try {
        window.electron.cancelAiMessage(activeSessionRef.current.sessionId);
        activeSessionRef.current.cleanup();
      } catch {
      }
      activeSessionRef.current = null;
    }

    const images = aiImages;
    setAiInput("");
    setAiImages([]);
    setAiLoading(true);

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: text,
      images: images.length > 0 ? images : undefined,
      created_at: new Date(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    scrollToEnd();

    const sessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sid-${Date.now()}-${randomHex(8)}`;

    setStreamingMessage({ sessionId, content: "", blocks: [] });

    const builder = new BlockBuilder();

    const offChunk = window.electron.onAiStreamChunk(
      (_e, payload) => {
        if (payload.sessionId !== sessionId || activeChatSessionIdRef.current !== chatSessionId) return;
        builder.pushText(payload.delta);
        setStreamingMessage((prev) =>
          prev && prev.sessionId === sessionId
            ? { ...prev, content: prev.content + payload.delta, blocks: builder.blocks() }
            : prev
        );
      }
    );
    const offToolCall = window.electron.onAiStreamToolCall(
      (_e, payload) => {
        if (payload.sessionId !== sessionId || activeChatSessionIdRef.current !== chatSessionId) return;
        builder.pushToolCall({ id: payload.id, name: payload.name, args: payload.args });
        setStreamingMessage((prev) =>
          prev && prev.sessionId === sessionId ? { ...prev, blocks: builder.blocks() } : prev
        );
      }
    );
    const offToolResult = window.electron.onAiStreamToolResult(
      (_e, payload) => {
        if (payload.sessionId !== sessionId || activeChatSessionIdRef.current !== chatSessionId) return;
        builder.pushToolResult(payload.id, payload.result, payload.isError);
        setStreamingMessage((prev) =>
          prev && prev.sessionId === sessionId ? { ...prev, blocks: builder.blocks() } : prev
        );
      }
    );
    const offEnd = window.electron.onAiStreamEnd(
      (_e, payload) => {
        if (payload.sessionId !== sessionId) return;
        cleanup();
        if (activeChatSessionIdRef.current !== chatSessionId) return;
        setChatMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: "assistant",
            content: payload.content,
            blocks: builder.blocks(),
            created_at: new Date(),
          },
        ]);
        setStreamingMessage(null);
        setAiLoading(false);
        scrollToEnd();
        void loadChatSessions();
      }
    );
    const offCompacting = window.electron.onAiCompacting(
      (_e, payload) => {
        if (payload.sessionId !== sessionId) return;
        if (activeChatSessionIdRef.current !== chatSessionId) return;
        if (payload.phase === 'compressing') {
          setCompacting({ round: payload.round ?? 0, maxRounds: payload.maxRounds ?? 3 });
        } else {
          setCompacting(null);
        }
      }
    );
    const offError = window.electron.onAiStreamError(
      (_e, payload) => {
        if (payload.sessionId !== sessionId) return;
        cleanup();
        setPendingContinuation(null);
        if (activeChatSessionIdRef.current !== chatSessionId) return;
        setChatMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
        setStreamingMessage(null);
        setAiLoading(false);
        console.error("AI stream failed:", payload.error);
        onErrorRef.current?.(payload.error || "未知错误");
        toast({
          title: "AI 回复失败",
          description: payload.error || "未知错误",
          variant: "destructive",
        });
      }
    );

    const offNeedContinue = window.electron.onAiNeedContinue(
      (_e, payload) => {
        if (payload.sessionId !== sessionId) return;
        if (activeChatSessionIdRef.current !== chatSessionId) return;
        setPendingContinuation({
          sessionId,
          rounds: payload.rounds,
          totalRounds: payload.totalRounds,
        });
      }
    );

    function cleanup() {
      offChunk();
      offToolCall();
      offToolResult();
      offEnd();
      offError();
      offCompacting();
      offNeedContinue();
      setCompacting(null);
      setPendingContinuation(null);
      if (activeSessionRef.current?.sessionId === sessionId) {
        activeSessionRef.current = null;
      }
    }

    activeSessionRef.current = { sessionId, cleanup };

    try {
      await window.electron.sendAiAgentStream(
        text,
        sessionId,
        chatSessionId,
        activeSkillIdRef.current,
        images.length > 0 ? images : undefined
      );
    } catch (err) {
      const isCurrentSession = activeSessionRef.current?.sessionId === sessionId;
      cleanup();
      if (!isCurrentSession) return;
      setChatMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      setStreamingMessage(null);
      setAiLoading(false);
      console.error("发起流式 AI 失败:", err);
      onErrorRef.current?.(err instanceof Error ? err.message : "未知错误");
      toast({
        title: "AI 请求失败",
        description: err instanceof Error ? err.message : "未知错误",
        variant: "destructive",
      });
    }
  }, [aiInput, aiImages, aiLoading, assistantView, createChatSession, loadChatSessions, scrollToEnd]);

  const handleCancelAiMessage = useCallback(() => {
    const active = activeSessionRef.current;
    if (!active) return;
    activeSessionRef.current = null;
    active.cleanup();
    try {
      window.electron.cancelAiMessage(active.sessionId);
    } catch (err) {
      console.error("取消 AI 流失败:", err);
    }
    setStreamingMessage((current) =>
      current?.sessionId === active.sessionId ? null : current
    );
    setPendingContinuation(null);
    setAiLoading(false);
  }, []);

  const handleContinueDecision = useCallback(
    (decision: "continue" | "stop") => {
      const pending = pendingContinuation;
      if (!pending) return;
      setPendingContinuation(null);
      window.electron
        .continueAiAgent(pending.sessionId, decision)
        .catch((err) => {
          console.error("续跑请求失败:", err);
          setStreamingMessage(null);
          setAiLoading(false);
        });
    },
    [pendingContinuation]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSendAiMessage();
      }
    },
    [handleSendAiMessage]
  );

  const handleNewChat = useCallback(async () => {
    handleCancelAiMessage();
    setAiInput("");
    setAiImages([]);
    await createChatSession();
  }, [createChatSession, handleCancelAiMessage]);

  const handleOpenChatSession = useCallback(async (session: AiChatSession) => {
    const requestId = ++historyRequestRef.current;
    handleCancelAiMessage();
    activeChatSessionIdRef.current = session.id;
    setActiveChatSession(session);
    setAssistantView("chat");
    setChatHistoryLoading(true);
    setAiInput("");
    setAiImages([]);
    setChatMessages([]);

    try {
      const history = await window.electron.getAiChatSessionHistory(session.id);
      if (
        requestId === historyRequestRef.current &&
        activeChatSessionIdRef.current === session.id
      ) {
        setChatMessages(
          history.map((m) => ({
            ...m,
            blocks: m.blocks,
          }))
        );
        scrollToEnd();
      }
    } catch (err) {
      console.error("加载AI对话历史失败", err);
    } finally {
      if (requestId === historyRequestRef.current) {
        setChatHistoryLoading(false);
      }
    }
  }, [handleCancelAiMessage, scrollToEnd]);

  const handleShowSessions = useCallback(() => {
    historyRequestRef.current += 1;
    handleCancelAiMessage();
    activeChatSessionIdRef.current = null;
    setActiveChatSession(null);
    setAssistantView("sessions");
    setChatHistoryLoading(false);
    setAiInput("");
    setAiImages([]);
    setChatMessages([]);
    setSessionsLoading(true);
    void loadChatSessions().finally(() => setSessionsLoading(false));
  }, [handleCancelAiMessage, loadChatSessions]);

  const handleDeleteChatSession = useCallback(async (chatSessionId: string) => {
    try {
      const success = await window.electron.deleteAiChatSession(chatSessionId);
      if (!success) return false;

      setChatSessions((current) => current.filter((session) => session.id !== chatSessionId));
      if (activeChatSessionIdRef.current === chatSessionId) {
        handleCancelAiMessage();
        activeChatSessionIdRef.current = null;
        setActiveChatSession(null);
        setAssistantView("sessions");
        setChatMessages([]);
        setAiInput("");
      }
      return true;
    } catch (err) {
      console.error("删除AI会话失败", err);
      return false;
    }
  }, [handleCancelAiMessage]);


  const [petBubble, setPetBubble] = useState<PetBubbleState | null>(null);
  const petStreamRef = useRef<{ sessionId: string; cleanup: () => void } | null>(null);

  const dismissPetBubble = useCallback(() => {
    const active = petStreamRef.current;
    if (active) {
      petStreamRef.current = null;
      active.cleanup();
      try {
        window.electron.cancelAiMessage(active.sessionId);
      } catch (err) {
        console.error("[pet-voice] 中止流失败:", err);
      }
    }
    setPetBubble(null);
  }, []);

  const patchPetBubble = useCallback((patch: Partial<PetBubbleState>) => {
    setPetBubble((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const syncPetTurnToHistory = useCallback(
    async (sessionId: string) => {
      if (activeChatSessionIdRef.current !== sessionId) return;
      if (activeSessionRef.current) return;

      const requestId = ++historyRequestRef.current;
      try {
        const history = await window.electron.getAiChatSessionHistory(sessionId);
        if (requestId !== historyRequestRef.current) return;
        if (activeChatSessionIdRef.current !== sessionId) return;
        setChatMessages(history.map((m) => ({ ...m, blocks: m.blocks })));
        scrollToEnd();
      } catch (err) {
        console.error("[pet-voice] 同步对话记录失败:", err);
      }
    },
    [scrollToEnd]
  );

  const beginPetVoice = useCallback(() => {
    if (petStreamRef.current) {
      const previous = petStreamRef.current;
      petStreamRef.current = null;
      previous.cleanup();
      try {
        window.electron.cancelAiMessage(previous.sessionId);
      } catch {
      }
    }
    setPetBubble({ phase: "listening", utterance: "", reply: "" });
  }, []);

  const sendPetVoiceMessage = useCallback(
    async (utterance: string) => {
      const text = utterance.trim();
      if (!text) return;

      let chatSessionId = activeChatSessionIdRef.current;
      if (!chatSessionId) {
        const session = await createChatSession();
        if (!session) {
          setPetBubble({
            phase: "error",
            utterance: text,
            reply: "",
            error: "无法创建对话，请稍后重试",
          });
          return;
        }
        chatSessionId = session.id;
      }

      const sessionId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `sid-${Date.now()}-${randomHex(8)}`;

      setPetBubble({ phase: "thinking", utterance: text, reply: "" });

      const offChunk = window.electron.onAiStreamChunk((_e, payload) => {
        if (payload.sessionId !== sessionId) return;
        setPetBubble((current) =>
          current
            ? {
                ...current,
                phase: "streaming",
                reply: current.reply + payload.delta,
              }
            : current
        );
      });

      const offEnd = window.electron.onAiStreamEnd((_e, payload) => {
        if (payload.sessionId !== sessionId) return;
        cleanup();
        setPetBubble((current) =>
          current
            ? {
                ...current,
                phase: "done",
                reply: payload.content || current.reply,
              }
            : current
        );
        void loadChatSessions();
        void syncPetTurnToHistory(sessionId);
      });

      const offError = window.electron.onAiStreamError((_e, payload) => {
        if (payload.sessionId !== sessionId) return;
        cleanup();
        setPetBubble((current) => ({
          phase: "error",
          utterance: text,
          reply: current?.reply ?? "",
          error: payload.error,
        }));
      });

      let autoContinued = 0;
      const offNeedContinue = window.electron.onAiNeedContinue((_e, payload) => {
        if (payload.sessionId !== sessionId) return;
        if (autoContinued >= MAX_PET_AUTO_CONTINUE) {
          offNeedContinue();
          return;
        }
        autoContinued += 1;
        window.electron.continueAiAgent(sessionId, "continue").catch((err) => {
          console.error("[pet-voice] 自动续跑失败:", err);
          cleanup();
          setPetBubble((current) => ({
            phase: "error",
            utterance: text,
            reply: current?.reply ?? "",
            error: "AI 处理中断",
          }));
        });
      });

      function cleanup() {
        offChunk();
        offEnd();
        offError();
        offNeedContinue();
        if (petStreamRef.current?.sessionId === sessionId) {
          petStreamRef.current = null;
        }
      }

      petStreamRef.current = { sessionId, cleanup };

      try {
        await window.electron.sendAiAgentStream(text, sessionId, chatSessionId, null);
      } catch (err) {
        cleanup();
        const message = err instanceof Error ? err.message : String(err);
        setPetBubble({
          phase: "error",
          utterance: text,
          reply: "",
          error: message,
        });
      }
    },
    [createChatSession, loadChatSessions, syncPetTurnToHistory]
  );

  useEffect(() => {
    return () => {
      const active = petStreamRef.current;
      if (active) {
        try {
          window.electron.cancelAiMessage(active.sessionId);
        } catch {
        }
        active.cleanup();
        petStreamRef.current = null;
      }
    };
  }, []);

  return {
    chatSessions,
    activeChatSession,
    assistantView,
    sessionsLoading,
    isCreatingSession,
    chatHistoryLoading,
    chatMessages,
    aiInput,
    aiImages,
    aiLoading,
    streamingMessage,
    compacting,
    pendingContinuation,
    handleContinueDecision,
    latestClipboardContent,
    chatEndRef,
    skills,
    activeSkillId,
    setAiInput,
    setActiveSkillId,
    addAiImages,
    removeAiImage,
    handleSendAiMessage,
    handleCancelAiMessage,
    handleKeyDown,
    handleNewChat,
    handleOpenChatSession,
    handleShowSessions,
    handleDeleteChatSession,
    petBubble,
    beginPetVoice,
    sendPetVoiceMessage,
    patchPetBubble,
    dismissPetBubble,
  };
}