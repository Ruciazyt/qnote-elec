import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useAutoGrowTextarea } from "./useAutoGrowTextarea";

interface HarnessProps {
  value: string;
  placeholder?: string;
}

function Harness({ value, placeholder }: HarnessProps) {
  const ref = useAutoGrowTextarea(value);
  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={() => {}}
    />
  );
}

const originalScrollHeight = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollHeight"
);

function mockScrollHeight(get: (el: HTMLTextAreaElement) => number) {
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return get(this);
    },
  });
}

function mockComputedSize(minHeight: string, maxHeight: string) {
  return vi
    .spyOn(window, "getComputedStyle")
    .mockImplementation(
      () =>
        ({
          minHeight,
          maxHeight,
          borderTopWidth: "0px",
          borderBottomWidth: "0px",
        }) as unknown as CSSStyleDeclaration
    );
}

afterEach(() => {
  if (originalScrollHeight) {
    Object.defineProperty(Element.prototype, "scrollHeight", originalScrollHeight);
  } else {
    delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>)
      .scrollHeight;
  }
});

describe("useAutoGrowTextarea", () => {
  it("空输入时按内容高度算，placeholder 换行不撑大输入框", () => {
    mockScrollHeight((el) => (el.placeholder ? 196 : 36));
    mockComputedSize("40px", "200px");

    const { container } = render(
      <Harness value="" placeholder="发起一个新对话..." />
    );
    const textarea = container.querySelector("textarea")!;

    expect(textarea.style.height).toBe("40px");
    expect(textarea.placeholder).toBe("发起一个新对话...");
  });

  it("内容超过上限时停在上限并允许滚动", () => {
    mockScrollHeight(() => 480);
    mockComputedSize("40px", "200px");

    const { container } = render(<Harness value="很长的一段内容" />);
    const textarea = container.querySelector("textarea")!;

    expect(textarea.style.height).toBe("200px");
    expect(textarea.style.overflowY).toBe("auto");
  });

  it("内容低于下限时保持下限", () => {
    mockScrollHeight(() => 20);
    mockComputedSize("40px", "200px");

    const { container } = render(<Harness value="短" />);
    const textarea = container.querySelector("textarea")!;

    expect(textarea.style.height).toBe("40px");
  });

  it("宽度变化后重新测量", async () => {
    let width = 320;
    let contentHeight = 36;
    mockScrollHeight(() => contentHeight);
    mockComputedSize("40px", "200px");

    const observers: Array<() => void> = [];
    const originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    try {
      const { container } = render(<Harness value="" />);
      const textarea = container.querySelector("textarea")!;
      Object.defineProperty(textarea, "clientWidth", {
        configurable: true,
        get: () => width,
      });

      expect(textarea.style.height).toBe("40px");

      contentHeight = 120;
      width = 160;
      await act(async () => {
        observers.forEach((notify) => notify());
      });

      expect(textarea.style.height).toBe("120px");
    } finally {
      window.ResizeObserver = originalResizeObserver;
    }
  });
});
