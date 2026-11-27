import { useCallback, useEffect, useRef } from "react";

const BOTTOM_THRESHOLD = 48;

export function useChatAutoScroll(
  messages: readonly unknown[],
  streaming?: unknown,
  compacting?: unknown
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const messageCount = messages.length;

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
  }, []);

  const pinToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    stickToBottomRef.current = true;
    pinToBottom();
  }, [messageCount, pinToBottom]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    pinToBottom();
  }, [streaming, compacting, pinToBottom]);

  return { scrollRef, onScroll };
}
