import { useCallback, useEffect, useRef, useState } from "react";
import { AiChatSession, ChatMessage } from "@/components/clipboard/types";
import { BlockBuilder, type AssistantBlock } from "@shared/aiBlocks";
import { randomHex } from "@/utils/randomId";

/**
 * 流式进行中的占位消息
 * 字段尽量对齐 ChatMessage，方便 AiChatPanel 渲染时少写分支
 */
export interface StreamingMessage {
  sessionId: string;
  content: string;
  /** 本次回复的有序分块（思考/工具/输出），实时构建 */
  blocks?: AssistantBlock[];
}

/**
 * AI 技能（Skill）
 */
export interface AiSkill {
  id: string;
  name: string;
  content: string;
  isCustom: boolean;
}

/**
 * 宠物语音气泡的状态
 *
 * 定义在 hook 而不是气泡组件里：它是数据层的一份状态快照，
 * 组件只负责渲染 —— 与 AiChatPanel 从本文件取 StreamingMessage 的做法一致。
 */
export type PetBubblePhase =
  /** 正在录音 */
  | "listening"
  /** 录音结束，正在识别 */
  | "transcribing"
  /** 识别完成，AI 还没开始回答 */
  | "thinking"
  /** AI 正在流式输出 */
  | "streaming"
  /** 本轮结束，等待用户手动关闭 */
  | "done"
  | "error";

export interface PetBubbleState {
  phase: PetBubblePhase;
  /** 用户说出的话（识别完成后才有） */
  utterance: string;
  /** AI 的回复，流式增长 */
  reply: string;
  /** 失败原因 */
  error?: string;
}

/**
 * 气泡这一轮最多自动续跑几轮。
 *
 * agent 循环撞上轮次上限会停下来问「是否继续」。对话框里这是个正常的
 * 「继续 / 停止」按钮，但气泡是语音场景的唯一反馈出口 —— 让用户去点一个
 * 他可能根本没看见的按钮不现实，所以这里自动续跑，并设上限防止无限循环。
 */
const MAX_PET_AUTO_CONTINUE = 3;

/**
 * useAiAssistant — AI 助手的全局状态与行为
 * 抽离自 HomePage，让 AI 助手可以脱离 HomePage 独立挂载为全局浮框
 *
 * 使用场景：仅在 App 根节点调用一次（多个实例会互相覆盖状态）
 *
 * 流式对话：
 *   - 走 sendAiMessageStream 流式 IPC，逐字渲染 AI 回复
 *   - streamingMessage 占位消息，AiChatPanel 渲染时与 chatMessages 等价处理
 *   - handleCancelAiMessage 中断时 abort in-flight 请求
 *
 * Skill 接入：
 *   - 加载用户创建的技能列表
 *   - activeSkillId 记录当前选中的技能（null = 不使用）
 *   - 发送时把 skillId 透传给主进程
 */
export function useAiAssistant() {
  const [chatSessions, setChatSessions] = useState<AiChatSession[]>([]);
  const [activeChatSession, setActiveChatSession] = useState<AiChatSession | null>(null);
  const [assistantView, setAssistantView] = useState<"sessions" | "chat">("sessions");
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  /** 当前正在累积的流式消息；null 表示没有进行中的流 */
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  /**
   * 会话压缩进度；非 null 时 AI 面板显示「正在压缩历史…」。
   *
   * 压缩是阻塞的（要等摘要生成完才继续），耗时可达数秒。
   * 没有这个状态用户只会看到界面不动 —— 而「应用在悄悄丢弃对话历史」
   * 这种行为不告知的话，比卡住本身更让人不安。
   */
  const [compacting, setCompacting] = useState<{ round: number; maxRounds: number } | null>(null);
  /**
   * 撞上轮次上限，等待用户决定是否继续
   *
   * 这期间 **aiLoading 保持 true** —— 输入框和发送按钮据此禁用，
   * 于是「用户直接发新消息打断续跑」这整类竞态一步消掉，不用再加标志位。
   */
  const [pendingContinuation, setPendingContinuation] = useState<{
    sessionId: string;
    rounds: number;
    totalRounds: number;
  } | null>(null);
  /** 最近一条文本剪贴板内容 — 用于空状态提示 */
  const [latestClipboardContent, setLatestClipboardContent] = useState<
    string | undefined
  >(undefined);

  // Skill：用户创建的技能列表 + 当前选中的技能（null = 不使用）
  const [skills, setSkills] = useState<AiSkill[]>([]);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  // ref 镜像：发送消息的回调里要读到最新的 activeSkillId，避免闭包过期
  const activeSkillIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeSkillIdRef.current = activeSkillId;
  }, [activeSkillId]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const activeChatSessionIdRef = useRef<string | null>(null);
  const historyRequestRef = useRef(0);
  const creatingSessionRef = useRef(false);
  // 用 ref 持有当前 sessionId 与 unsubscribe 列表，避免闭包过期
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

  // 初次挂载：拉取会话列表
  useEffect(() => {
    let cancelled = false;
    void loadChatSessions().finally(() => {
      if (!cancelled) setSessionsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadChatSessions]);

  // 监听剪贴板变化 — 仅跟踪最新文本内容用于空状态提示
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

  // Skill：挂载时加载技能列表
  useEffect(() => {
    let cancelled = false;
    // 内部已经 try/catch，不会 reject；这里只是发起即忘，显式 void 忽略返回值
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

  // 卸载时清理仍在进行的流
  useEffect(() => {
    return () => {
      const active = activeSessionRef.current;
      if (active) {
        try {
          window.electron.cancelAiMessage(active.sessionId);
        } catch {
          /* ignore */
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

  const handleSendAiMessage = useCallback(async () => {
    const text = aiInput.trim();
    if (!text || aiLoading) return;

    let chatSessionId = activeChatSessionIdRef.current;
    if (!chatSessionId && assistantView === "sessions") {
      const session = await createChatSession();
      if (!session) return;
      chatSessionId = session.id;
    }
    if (!chatSessionId) return;

    // 防御：如果有上一次遗留的 session，先取消
    if (activeSessionRef.current) {
      try {
        window.electron.cancelAiMessage(activeSessionRef.current.sessionId);
        activeSessionRef.current.cleanup();
      } catch {
        /* ignore */
      }
      activeSessionRef.current = null;
    }

    setAiInput("");
    setAiLoading(true);

    // 临时用户消息 id 用于失败时回滚
    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: text,
      created_at: new Date(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    scrollToEnd();

    // 用 crypto.randomUUID 拿 sessionId；老浏览器可改用 Math.random 拼字符串
    const sessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sid-${Date.now()}-${randomHex(8)}`;

    setStreamingMessage({ sessionId, content: "", blocks: [] });

    /**
     * 有序分块构建器 —— 与主进程落库用的是同一份实现（shared/aiBlocks），
     * 所以流式显示和重启后回放渲染出来的顺序必然一致。
     *
     * 用闭包实例而不是 state：offEnd 里要把最终 blocks 挂到落库那条消息上，
     * 而那里拿不到当前的 streamingMessage（回调闭包不跟着 state 更新）。
     */
    const builder = new BlockBuilder();

    // 一次性订阅事件，end/error 时自动清理
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
    // 工具调用事件
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
    /**
     * 压缩进度 —— 压缩要额外调一次 LLM，期间界面没有 chunk 流出。
     * 不给提示的话用户只会看到「转圈但不出字」，分不清是在思考还是卡死。
     */
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
        // 失败回滚用户消息
        setChatMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
        setStreamingMessage(null);
        setAiLoading(false);
        console.error("AI stream failed:", payload.error);
      }
    );

    /**
     * 撞上轮次上限 —— 主进程要问用户「是否继续」
     *
     * 这里刻意**不** cleanup、**不** 清 streamingMessage、**不** setAiLoading(false)：
     * 已流出来的正文和工具块要留在屏幕上，用户点「继续」之后它们还在原地接着写。
     * 监听也必须留着 —— 续跑那几轮的事件走的是同一个 sessionId。
     */
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
      // 清理时一并收起压缩提示，否则中断/失败路径下它会一直挂着
      setCompacting(null);
      setPendingContinuation(null);
      if (activeSessionRef.current?.sessionId === sessionId) {
        activeSessionRef.current = null;
      }
    }

    activeSessionRef.current = { sessionId, cleanup };

    try {
      // 默认走 agent 流式（agent IPC 内部会按用户偏好决定是否加载工具）
      // skillId 透传：主进程据此把 skill 应用到本次提问
      await window.electron.sendAiAgentStream(
        text,
        sessionId,
        chatSessionId,
        activeSkillIdRef.current
      );
    } catch (err) {
      const isCurrentSession = activeSessionRef.current?.sessionId === sessionId;
      cleanup();
      if (!isCurrentSession) return;
      setChatMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      setStreamingMessage(null);
      setAiLoading(false);
      console.error("发起流式 AI 失败:", err);
    }
  }, [aiInput, aiLoading, assistantView, createChatSession, loadChatSessions, scrollToEnd]);

  /** 用户中途取消 */
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

  /**
   * 回答「本轮已达上限，是否继续」
   *
   * 不 cleanup、不动 streamingMessage —— 续跑的事件还走同一个 sessionId，
   * 已经订好的监听要留着接着收。aiLoading 也保持 true（输入框禁用）。
   */
  const handleContinueDecision = useCallback(
    (decision: "continue" | "stop") => {
      const pending = pendingContinuation;
      if (!pending) return;
      setPendingContinuation(null);
      window.electron
        .continueAiAgent(pending.sessionId, decision)
        .catch((err) => {
          console.error("续跑请求失败:", err);
          // 主进程那边已经没记录了，这里必须自己收尾，否则界面永远卡在「思考中」
          setStreamingMessage(null);
          setAiLoading(false);
        });
    },
    [pendingContinuation]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 输入框是多行 textarea：Enter 发送，Shift+Enter 换行
      // （换行交给 textarea 自己处理，这里只拦截裸 Enter）
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        // 发送逻辑自带错误处理，这里不等待结果，显式 void 忽略
        void handleSendAiMessage();
      }
    },
    [handleSendAiMessage]
  );

  const handleNewChat = useCallback(async () => {
    handleCancelAiMessage();
    setAiInput("");
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
    setChatMessages([]);

    try {
      const history = await window.electron.getAiChatSessionHistory(session.id);
      if (
        requestId === historyRequestRef.current &&
        activeChatSessionIdRef.current === session.id
      ) {
        // 主进程返回的是 DB 列名（tool_calls），转成 ChatMessage 的 camelCase
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

  // ============================================================
  // 宠物语音气泡通路
  // ============================================================
  //
  // 与对话框那套 stream 逻辑**并列**而不是复用 handleSendAiMessage，原因有三：
  //   1. 对话框那条要往 chatMessages / streamingMessage / aiInput 里写，
  //      气泡这条一件都不该碰 —— 用户没打开对话框，界面不该因此变化
  //   2. 对话框有「继续 / 停止」按钮处理轮次上限，气泡没有
  //   3. 对话框失败会回滚用户消息，气泡失败只显示错误
  // 三者的差异足够大，强行合并出来的分支比重复这几十行更难维护。
  // 会话复用与落库则都走同一套主进程逻辑，历史不会分叉。

  /** 气泡当前状态；null = 不显示 */
  const [petBubble, setPetBubble] = useState<PetBubbleState | null>(null);
  /** 气泡这一轮在-flight 的流，用于关闭时中止 + 新一轮前清理 */
  const petStreamRef = useRef<{ sessionId: string; cleanup: () => void } | null>(null);

  /** 关闭气泡 —— 同时中止仍在进行的流，避免它继续往一个已消失的界面推数据 */
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

  /** 只改气泡状态，不动其它任何 AI 状态 */
  const patchPetBubble = useCallback((patch: Partial<PetBubbleState>) => {
    setPetBubble((current) => (current ? { ...current, ...patch } : current));
  }, []);

  /**
   * 语音那一轮结束后，把已落库的记录同步进 chatMessages
   *
   * ## 为什么必须补这一步
   *
   * 气泡通路只往 setPetBubble 写，**完全不碰 chatMessages**（面板那条通路才是动它的）。
   * 收起态时无所谓 —— 用户看到的是气泡。但面板一旦展开，气泡就不再渲染了
   * （见 FloatingAiAssistant 里的 `!expanded` 条件），这一轮如果还只存在于气泡状态里，
   * 就会变成"问了个寂寞"：面板是空的，上一轮问答像没发生过。
   *
   * ## 为什么不在展开的那一刻才去拉
   *
   * 展开时刷新只覆盖"先说完、后展开"；如果用户是在流还没结束时展开的，展开那一刻
   * 拉到的历史是残缺的，之后再没有第二次刷新。挂在流结束处刷新则两种顺序都对：
   * 收起时把数据备好，展开时若正在流式则等它结束自然补上。
   *
   * 面板里正有另一条通路的流在跑时**不刷** —— 那是面板自己的中间态，
   * 一次历史刷新会把正在流式的那条消息冲掉。
   */
  const syncPetTurnToHistory = useCallback(
    async (sessionId: string) => {
      if (activeChatSessionIdRef.current !== sessionId) return;
      if (activeSessionRef.current) return;

      const requestId = ++historyRequestRef.current;
      try {
        const history = await window.electron.getAiChatSessionHistory(sessionId);
        if (requestId !== historyRequestRef.current) return;
        if (activeChatSessionIdRef.current !== sessionId) return;
        // 主进程返回的是 DB 列名（tool_calls），转成 ChatMessage 的 camelCase
        setChatMessages(history.map((m) => ({ ...m, blocks: m.blocks })));
        scrollToEnd();
      } catch (err) {
        console.error("[pet-voice] 同步对话记录失败:", err);
      }
    },
    [scrollToEnd]
  );

  /** 气泡进入「正在听」；录音结束 → 识别 → 发送，由调用方串联 */
  const beginPetVoice = useCallback(() => {
    // 上一次还没说完就又按了快捷键：先把上一轮收掉
    if (petStreamRef.current) {
      const previous = petStreamRef.current;
      petStreamRef.current = null;
      previous.cleanup();
      try {
        window.electron.cancelAiMessage(previous.sessionId);
      } catch {
        /* ignore */
      }
    }
    setPetBubble({ phase: "listening", utterance: "", reply: "" });
  }, []);

  /**
   * 识别成功后把这句话送给 AI，回复以流式写进气泡
   *
   * 复用当前的对话：有正在进行的对话就接着聊，没有就新建一个。
   * 这样连续说几句会形成连贯的一串，而不是每次都变成孤立的"新建对话"。
   */
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
                // 流结束事件带的是完整正文；用它兜底可修正个别丢失的 chunk
                reply: payload.content || current.reply,
              }
            : current
        );
        void loadChatSessions();
        // 这一轮已落库 → 同步进对话记录，展开面板时能看到（气泡此时已不再渲染）
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

      /**
       * 撞轮次上限 → 自动续跑
       *
       * 对话框那边是问用户，气泡这边没处问。语音场景下用户说完就走了，
       * 弹一个「是否继续」只会让人莫名其妙，所以替他决定继续，但设上限。
       */
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

  // 组件卸载时中止气泡的流 —— 与对话流的清理逻辑同源，避免泄漏
  useEffect(() => {
    return () => {
      const active = petStreamRef.current;
      if (active) {
        try {
          window.electron.cancelAiMessage(active.sessionId);
        } catch {
          /* ignore */
        }
        active.cleanup();
        petStreamRef.current = null;
      }
    };
  }, []);

  return {
    // state
    chatSessions,
    activeChatSession,
    assistantView,
    sessionsLoading,
    isCreatingSession,
    chatHistoryLoading,
    chatMessages,
    aiInput,
    aiLoading,
    streamingMessage,
    compacting,
    pendingContinuation,
    handleContinueDecision,
    latestClipboardContent,
    chatEndRef,
    // skill
    skills,
    activeSkillId,
    // setters
    setAiInput,
    setActiveSkillId,
    // handlers
    handleSendAiMessage,
    handleCancelAiMessage,
    handleKeyDown,
    handleNewChat,
    handleOpenChatSession,
    handleShowSessions,
    handleDeleteChatSession,
    // 宠物语音气泡
    petBubble,
    beginPetVoice,
    sendPetVoiceMessage,
    patchPetBubble,
    dismissPetBubble,
  };
}