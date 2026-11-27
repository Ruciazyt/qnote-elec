import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { StreamingMessage } from "@/hooks/ai/useAiAssistant";
import type { ChatMessage } from "../types";
import { ChatMessageList } from "./ChatMessageList";

const SCROLL_HEIGHT = 1200;
const CLIENT_HEIGHT = 400;

const userMessage: ChatMessage = {
  id: 1,
  role: "user",
  content: "帮我看下仓库",
  created_at: new Date(),
};

function streaming(content: string): StreamingMessage {
  return {
    sessionId: "s1",
    content,
    blocks: [{ kind: "text", text: content }],
  };
}

function mockScrollMetrics(el: HTMLElement) {
  let scrollTop = 0;
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => SCROLL_HEIGHT,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => CLIENT_HEIGHT,
  });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  return () => scrollTop;
}

describe("ChatMessageList 自动滚动", () => {
  it("流式回复变长时把消息列表滚到底部", () => {
    const { container, rerender } = render(
      <ChatMessageList
        messages={[userMessage]}
        isHistoryLoading={false}
        aiLoading
        streamingMessage={streaming("网关配置读到了")}
        copiedMsgId={null}
        hoveredMsgId={null}
        onCopyMessage={() => {}}
        onHoverMessage={() => {}}
        onPreviewImage={() => {}}
      />
    );
    const scroller = container.querySelector(".ai-message-scroll") as HTMLElement;
    const readScrollTop = mockScrollMetrics(scroller);

    rerender(
      <ChatMessageList
        messages={[userMessage]}
        isHistoryLoading={false}
        aiLoading
        streamingMessage={streaming("网关配置读到了，relay 令牌为空，我确认一下网关是否在监听")}
        copiedMsgId={null}
        hoveredMsgId={null}
        onCopyMessage={() => {}}
        onHoverMessage={() => {}}
        onPreviewImage={() => {}}
      />
    );

    expect(readScrollTop()).toBe(SCROLL_HEIGHT);
  });
});
