import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, Square } from "lucide-react";
import type { IslandAiActivity } from "@shared/island";
import { DEFAULT_AI_CHAT_SESSION_ID } from "@shared/constants/aiChat";
import { elapsedDuration } from "../format";

interface AiChatPanelProps {
  activity: IslandAiActivity;
  onOpenMain: () => void;
}

/** 面板里显示的一条消息 */
interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 正在流式输出 */
  streaming?: boolean;
}

/** 最多显示多少条历史 —— 面板只有 480px 高，再多也看不见 */
const HISTORY_LIMIT = 30;

/** 输入框最多长到几行 */
const MAX_INPUT_HEIGHT = 76;

function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 没有 randomUUID 时退到 getRandomValues —— 同样是不可预测的随机源。
  // 不退回 Math.random：那是可预测的伪随机（S2245）。
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `island-${Date.now()}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * AI 对话页
 *
 * 岛上直接能提问 —— 不必切回主窗口。回复走的是主进程那条
 * `send-ai-agent-stream`，和主窗口的助手是同一套流式协议。
 *
 * 对话落在**默认 AI 会话**里：岛里问的，主窗口的助手接着看得到；
 * 反过来主窗口里聊的，岛上也读得到同一份历史。
 */
export function AiChatPanel({ activity, onOpenMain }: AiChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 当前这一轮由岛发起的会话 id —— 流式事件按它过滤 */
  const sessionRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // ── 历史 ────────────────────────────────────────────────────────────────

  const loadHistory = useCallback(async () => {
    try {
      const history = await window.electron.getAiChatSessionHistory(DEFAULT_AI_CHAT_SESSION_ID);
      const list = (Array.isArray(history) ? history : [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-HISTORY_LIMIT)
        .map((m) => ({
          id: `h-${m.id}`,
          role: m.role as "user" | "assistant",
          content: m.content ?? "",
        }));
      setMessages(list);
    } catch {
      /* 读不到就当是空会话 */
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // ── 流式 ────────────────────────────────────────────────────────────────

  useEffect(() => {
    /** 退订函数未必都有 —— 收齐了统一撤 */
    const cleanups: Array<() => void> = [];
    const track = (value: unknown) => {
      if (typeof value === "function") cleanups.push(value as () => void);
    };

    track(
      window.electron.onAiStreamChunk((_event, payload) => {
        if (payload.sessionId !== sessionRef.current) return;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (!last || last.role !== "assistant") return prev;
          next[next.length - 1] = { ...last, content: last.content + payload.delta };
          return next;
        });
      })
    );

    track(
      window.electron.onAiStreamEnd((_event, payload) => {
        if (payload.sessionId !== sessionRef.current) return;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (!last || last.role !== "assistant") return prev;
          next[next.length - 1] = { ...last, content: payload.content, streaming: false };
          return next;
        });
        setStreaming(false);
        sessionRef.current = null;
      })
    );

    track(
      window.electron.onAiStreamError((_event, payload) => {
        if (payload.sessionId !== sessionRef.current) return;
        setError(payload.error);
        setStreaming(false);
        sessionRef.current = null;
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (!last || last.role !== "assistant") return prev;
          // 出错的那条不留个空白气泡
          if (!last.content) return next.slice(0, -1);
          next[next.length - 1] = { ...last, streaming: false };
          return next;
        });
      })
    );

    return () => {
      cleanups.forEach((off) => off());
    };
  }, []);

  // 新消息进来时贴着底部看
  useEffect(() => {
    const node = bottomRef.current;
    // scrollIntoView 在 jsdom 里没有 —— 判一下再用
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "end" });
    }
  }, [messages]);

  // ── 发消息 ──────────────────────────────────────────────────────────────

  const canSend = input.trim().length > 0 && !streaming;

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const sessionId = newSessionId();
    sessionRef.current = sessionId;
    setInput("");
    setError(null);
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      { id: `u-${sessionId}`, role: "user", content: text },
      { id: `a-${sessionId}`, role: "assistant", content: "", streaming: true },
    ]);

    try {
      await window.electron.sendAiAgentStream(text, sessionId, DEFAULT_AI_CHAT_SESSION_ID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发起请求失败");
      setStreaming(false);
      sessionRef.current = null;
      setMessages((prev) => prev.slice(0, -1));
    }
  }, [input, streaming]);

  const stop = useCallback(() => {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    window.electron.cancelAiMessage(sessionId);
  }, []);

  // 输入框随内容长高，到三行就不再长
  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    // 先归零再量 —— 有高度限制时 scrollHeight 量到的是被截断后的高度
    element.style.height = "auto";
    // scrollHeight 含 padding 不含 border，而 height 按 border-box 算 ——
    // 少补这点边框，内容就会比框高一线，多出一条竖滚动条。
    const styles = window.getComputedStyle(element);
    const border =
      (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0);
    element.style.height = `${Math.min(element.scrollHeight + border, MAX_INPUT_HEIGHT)}px`;
  }, [input]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      void send();
    },
    [send]
  );

  // 主窗口那边发起的任务 —— 岛上看得见状态，也能直接停掉
  const foreignActivity = useMemo(() => {
    if (!activity.running) return null;
    if (activity.sessionId && activity.sessionId === sessionRef.current) return null;
    return activity;
  }, [activity]);

  return (
    <div className="island-chat">
      {foreignActivity ? (
        <div className="island-ai-status">
          <span className="island-ai-light" data-running="true" />
          <div className="flex-1 min-w-0">
            <div className="island-row-title">{foreignActivity.title || "正在处理…"}</div>
            <div className="island-row-meta">
              {foreignActivity.startedAt
                ? `已运行 ${elapsedDuration(Date.now() - foreignActivity.startedAt)}`
                : "正在运行"}
              {foreignActivity.tool ? ` · ${foreignActivity.tool}` : ""}
            </div>
          </div>
          <button
            type="button"
            className="island-header-btn"
            title="停止这一轮"
            aria-label="停止这一轮"
            onClick={() => {
              if (foreignActivity.sessionId) {
                window.electron.cancelAiMessage(foreignActivity.sessionId);
              }
            }}
          >
            <Square size={13} strokeWidth={2} />
          </button>
        </div>
      ) : null}

      <div className="island-chat-messages">
        {messages.length === 0 ? (
          <div className="island-empty">
            <Bot size={22} strokeWidth={1.5} className="island-icon-muted" />
            <div className="island-empty-title">问点什么</div>
            <div className="island-empty-text">
              和主窗口的助手是同一段对话，这里问的它接着看得到
            </div>
            <button type="button" className="island-link-btn" onClick={onOpenMain}>
              打开助手
            </button>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="island-msg" data-role={message.role}>
              <div className="island-msg-body">{message.content}</div>
              {message.streaming && !message.content ? (
                <span className="island-msg-caret" aria-label="正在回复" />
              ) : null}
            </div>
          ))
        )}
        {error ? <div className="island-chat-error">{error}</div> : null}
        <div ref={bottomRef} />
      </div>

      <div className="island-chat-composer">
        <textarea
          ref={inputRef}
          className="island-chat-input"
          rows={1}
          value={input}
          placeholder="问点什么…"
          aria-label="给 AI 发消息"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {streaming ? (
          <button
            type="button"
            className="island-send-btn"
            data-stop="true"
            title="停止"
            aria-label="停止生成"
            onClick={stop}
          >
            <Square size={12} strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            className="island-send-btn"
            title="发送"
            aria-label="发送"
            disabled={!canSend}
            onClick={() => void send()}
          >
            <ArrowUp size={15} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
