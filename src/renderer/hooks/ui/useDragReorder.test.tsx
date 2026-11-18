import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useDragReorder } from "./useDragReorder";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const CONTAINER_RECT: Rect = { left: 0, top: 0, width: 208, height: 108 };
const COLUMNS = 2;
const CELL_WIDTH = 104;
const CELL_HEIGHT = 54;
const TILE_WIDTH = 100;
const TILE_HEIGHT = 50;

function makeRect(rect: Rect): DOMRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect;
}

function currentLayout(): Map<string, Rect> {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>("[data-drag-item-id]")
  );
  const order = nodes.map((node) => node.dataset.dragItemId ?? "");
  const lifted = nodes.find((node) => node.dataset.dragState === "dragged");
  const liftedId = lifted?.dataset.dragItemId ?? null;

  const rects = new Map<string, Rect>();
  const flowing = order.filter((id) => id !== liftedId);
  flowing.forEach((id, index) => {
    rects.set(id, {
      left: (index % COLUMNS) * CELL_WIDTH,
      top: Math.floor(index / COLUMNS) * CELL_HEIGHT,
      width: TILE_WIDTH,
      height: TILE_HEIGHT,
    });
  });

  if (liftedId) {
    const index = order.indexOf(liftedId);
    rects.set(liftedId, {
      left: (index % COLUMNS) * CELL_WIDTH,
      top: Math.floor(index / COLUMNS) * CELL_HEIGHT,
      width: TILE_WIDTH,
      height: TILE_HEIGHT,
    });
  }
  return rects;
}

function Harness({
  ids,
  onReorder,
}: {
  ids: string[];
  onReorder: (next: string[]) => void;
}) {
  const drag = useDragReorder({
    ids,
    onReorder,
    mode: "grid",
    columns: COLUMNS,
    amplitude: 10,
  });

  return (
    <div
      ref={drag.containerRef}
      onPointerDown={drag.handlePointerDown}
      data-drag-active={drag.isDragging ? "true" : "false"}
      data-testid="container">
      {ids.map((id) => (
        <div
          key={id}
          ref={drag.registerItem(id)}
          data-drag-item-id={id}
          data-drag-state={drag.stateOf(id)}
          data-testid={`item-${id}`}
          onKeyDown={(event) => drag.handleKeyDown(id, event)}>
          <button type="button" data-testid={`inner-${id}`}>
            open
          </button>
        </div>
      ))}
      <div
        ref={drag.hintRef}
        data-active="false"
        data-orientation="vertical"
        data-testid="hint">
        <div />
      </div>
    </div>
  );
}

function firePointer(target: EventTarget, type: string, clientX: number, clientY: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
}

function fireKey(target: EventTarget, key: string) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    );
  });
}

function getItem(id: string): HTMLElement {
  return document.querySelector(`[data-testid="item-${id}"]`) as HTMLElement;
}

function getHint(): HTMLElement {
  return document.querySelector('[data-testid="hint"]') as HTMLElement;
}

describe("拖拽重排引擎", () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function mockRect(this: Element) {
        const id = this.getAttribute("data-drag-item-id");
        if (id) {
          const rect = currentLayout().get(id);
          if (rect) return makeRect(rect);
        }
        return makeRect(CONTAINER_RECT);
      });
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it("按住并移动超过阈值后抬起被拖项", () => {
    render(<Harness ids={["a", "b", "c", "d"]} onReorder={() => {}} />);

    firePointer(getItem("a"), "pointerdown", 10, 10);
    firePointer(window, "pointermove", 12, 11);
    expect(getItem("a").dataset.dragState).toBe("idle");

    firePointer(window, "pointermove", 40, 40);
    expect(getItem("a").dataset.dragState).toBe("dragged");
    expect(
      document.querySelector('[data-testid="container"]')?.getAttribute("data-drag-active")
    ).toBe("true");
  });

  it("落在别人的位置时画出提示线，落回自己原位时不画", () => {
    render(<Harness ids={["a", "b", "c", "d"]} onReorder={() => {}} />);

    firePointer(getItem("a"), "pointerdown", 10, 10);
    firePointer(window, "pointermove", 40, 40);
    expect(getHint().dataset.active).toBe("false");

    firePointer(window, "pointermove", 150, 25);
    expect(getHint().dataset.active).toBe("true");
    expect(getHint().dataset.orientation).toBe("vertical");

    firePointer(window, "pointermove", 10, 10);
    expect(getHint().dataset.active).toBe("false");
  });

  it("线两侧的项按波纹规则向两侧让位", () => {
    render(<Harness ids={["a", "b", "c", "d"]} onReorder={() => {}} />);

    firePointer(getItem("a"), "pointerdown", 10, 10);
    firePointer(window, "pointermove", 150, 25);

    expect(getItem("b").style.getPropertyValue("--drag-x")).toBe("-10px");
    expect(getItem("b").style.getPropertyValue("--drag-delay")).toBe("0ms");
    expect(getItem("c").style.getPropertyValue("--drag-x")).toBe("10px");
    expect(getItem("d").style.getPropertyValue("--drag-x")).toBe("0px");
  });

  it("在线内放下后按新顺序回调", () => {
    const onReorder = vi.fn();
    render(<Harness ids={["a", "b", "c", "d"]} onReorder={onReorder} />);

    firePointer(getItem("a"), "pointerdown", 10, 10);
    firePointer(window, "pointermove", 150, 25);
    firePointer(window, "pointerup", 150, 25);

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c", "d"]);
  });

  it("拖到列表外放下则取消，不改顺序", () => {
    const onReorder = vi.fn();
    render(<Harness ids={["a", "b", "c", "d"]} onReorder={onReorder} />);

    firePointer(getItem("a"), "pointerdown", 10, 10);
    firePointer(window, "pointermove", 150, 25);
    firePointer(window, "pointerup", 400, 400);

    expect(onReorder).not.toHaveBeenCalled();
    expect(getItem("a").dataset.dragState).toBe("idle");
  });

  it("按 Esc 取消拖拽", () => {
    const onReorder = vi.fn();
    render(<Harness ids={["a", "b", "c", "d"]} onReorder={onReorder} />);

    firePointer(getItem("a"), "pointerdown", 10, 10);
    firePointer(window, "pointermove", 150, 25);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onReorder).not.toHaveBeenCalled();
    expect(getItem("a").dataset.dragState).toBe("idle");
  });

  it("键盘也能重排：空格拾起、方向键移动", () => {
    const onReorder = vi.fn();
    render(<Harness ids={["a", "b", "c", "d"]} onReorder={onReorder} />);

    fireKey(getItem("a"), " ");
    expect(getItem("a").dataset.dragState).toBe("grabbed");

    fireKey(getItem("a"), "ArrowRight");
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c", "d"]);
  });

  it("reduced-motion 下只保留提示线，项不再让位", () => {
    const mediaSpy = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList
    );

    render(<Harness ids={["a", "b", "c", "d"]} onReorder={() => {}} />);

    firePointer(getItem("a"), "pointerdown", 10, 10);
    firePointer(window, "pointermove", 150, 25);

    expect(getHint().dataset.active).toBe("true");
    expect(getItem("b").style.getPropertyValue("--drag-x")).toBe("0px");
    expect(getItem("c").style.getPropertyValue("--drag-x")).toBe("0px");

    mediaSpy.mockRestore();
  });

  it("内层按钮上的按键不触发拾起", () => {
    render(<Harness ids={["a", "b", "c", "d"]} onReorder={() => {}} />);

    const inner = document.querySelector('[data-testid="inner-a"]') as HTMLElement;
    fireKey(inner, " ");
    expect(getItem("a").dataset.dragState).toBe("idle");
  });

  it("键盘重排按 Esc 还原", () => {
    const onReorder = vi.fn();
    render(<Harness ids={["a", "b", "c", "d"]} onReorder={onReorder} />);

    fireKey(getItem("a"), " ");
    fireKey(getItem("a"), "ArrowRight");
    onReorder.mockClear();

    fireKey(getItem("a"), "Escape");
    expect(onReorder).toHaveBeenCalledWith(["a", "b", "c", "d"]);
  });
});
