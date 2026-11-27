import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useChatAutoScroll } from "./useChatAutoScroll";

const SCROLL_HEIGHT = 900;
const CLIENT_HEIGHT = 300;

function Harness({
  messages,
  streaming,
}: {
  messages: string[];
  streaming?: string;
}) {
  const { scrollRef, onScroll } = useChatAutoScroll(messages, streaming);
  return (
    <div ref={scrollRef} onScroll={onScroll} data-testid="scroller">
      {messages.map((item) => (
        <div key={item}>{item}</div>
      ))}
    </div>
  );
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
  return {
    get value() {
      return scrollTop;
    },
    set value(next: number) {
      scrollTop = next;
    },
  };
}

describe("useChatAutoScroll", () => {
  it("流式输出时贴着底部滚动", () => {
    const { rerender } = render(<Harness messages={["用户"]} streaming="回" />);
    const el = screen.getByTestId("scroller");
    const metrics = mockScrollMetrics(el);

    rerender(<Harness messages={["用户"]} streaming="回复内容变长了" />);

    expect(metrics.value).toBe(SCROLL_HEIGHT);
  });

  it("用户往上翻之后不再自动下滚", () => {
    const { rerender } = render(<Harness messages={["用户"]} streaming="回" />);
    const el = screen.getByTestId("scroller");
    const metrics = mockScrollMetrics(el);

    metrics.value = 0;
    fireEvent.scroll(el);
    rerender(<Harness messages={["用户"]} streaming="回复内容变长了" />);

    expect(metrics.value).toBe(0);
  });

  it("用户翻回底部后恢复跟随", () => {
    const { rerender } = render(<Harness messages={["用户"]} streaming="回" />);
    const el = screen.getByTestId("scroller");
    const metrics = mockScrollMetrics(el);

    metrics.value = 0;
    fireEvent.scroll(el);
    metrics.value = SCROLL_HEIGHT - CLIENT_HEIGHT;
    fireEvent.scroll(el);
    rerender(<Harness messages={["用户"]} streaming="回复内容变长了" />);

    expect(metrics.value).toBe(SCROLL_HEIGHT);
  });

  it("来了新消息时强制滚到底部", () => {
    const { rerender } = render(<Harness messages={["用户"]} streaming="回" />);
    const el = screen.getByTestId("scroller");
    const metrics = mockScrollMetrics(el);

    metrics.value = 0;
    fireEvent.scroll(el);
    rerender(<Harness messages={["用户", "AI"]} streaming="回" />);

    expect(metrics.value).toBe(SCROLL_HEIGHT);
  });
});
