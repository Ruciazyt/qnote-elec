import { describe, expect, it } from "vitest";
import {
  computeGap,
  computeRipples,
  findGapIndex,
  groupRows,
  insertAt,
  rippleAmplitude,
  type DragSlot,
} from "./dragReorderGeometry";

const grid: DragSlot[] = [
  { id: "a", x: 0, y: 0, w: 100, h: 60 },
  { id: "b", x: 104, y: 0, w: 100, h: 60 },
  { id: "c", x: 0, y: 64, w: 100, h: 60 },
  { id: "d", x: 104, y: 64, w: 100, h: 60 },
];

const singleRow: DragSlot[] = [
  { id: "a", x: 0, y: 0, w: 100, h: 60 },
  { id: "b", x: 104, y: 0, w: 100, h: 60 },
];

describe("拖拽重排几何", () => {
  describe("波纹振幅", () => {
    it("按 A x 0.7^n 递减", () => {
      expect(rippleAmplitude(10, 0)).toBe(10);
      expect(rippleAmplitude(10, 1)).toBeCloseTo(7, 5);
      expect(rippleAmplitude(10, 2)).toBeCloseTo(4.9, 5);
      expect(rippleAmplitude(8, 1)).toBeCloseTo(5.6, 5);
    });
  });

  describe("分组", () => {
    it("同一行的项归到一组并记下起始下标", () => {
      const rows = groupRows(grid);
      expect(rows).toHaveLength(2);
      expect(rows[0].slots.map((slot) => slot.id)).toEqual(["a", "b"]);
      expect(rows[0].start).toBe(0);
      expect(rows[1].slots.map((slot) => slot.id)).toEqual(["c", "d"]);
      expect(rows[1].start).toBe(2);
    });
  });

  describe("落点提示线", () => {
    it("横排用竖线，画在两列之间", () => {
      const gap = computeGap(singleRow, "row", 1);
      expect(gap?.orientation).toBe("vertical");
      expect(gap?.x).toBe(102);
      expect(gap?.length).toBe(60);
    });

    it("竖列用横线，画在两行之间", () => {
      const gap = computeGap(grid, "list", 2);
      expect(gap?.orientation).toBe("horizontal");
      expect(gap?.y).toBe(62);
      expect(gap?.length).toBe(204);
    });

    it("网格跨行时用横线，铺满整行宽度", () => {
      const gap = computeGap(grid, "grid", 2);
      expect(gap?.orientation).toBe("horizontal");
      expect(gap?.y).toBe(62);
      expect(gap?.x).toBe(0);
      expect(gap?.length).toBe(204);
    });

    it("网格行内用竖线，只占本行高度", () => {
      const gap = computeGap(grid, "grid", 3);
      expect(gap?.orientation).toBe("vertical");
      expect(gap?.x).toBe(102);
      expect(gap?.y).toBe(64);
      expect(gap?.length).toBe(60);
    });

    it("列表为空时没有提示线", () => {
      expect(computeGap([], "grid", 0)).toBeNull();
    });
  });

  describe("波纹位移", () => {
    it("横排：线两侧的项向两侧倒", () => {
      const ripples = computeRipples(grid, "row", 1, 10);
      expect(ripples.get("a")?.dx).toBe(-10);
      expect(ripples.get("b")?.dx).toBe(10);
      expect(ripples.get("a")?.delay).toBe(0);
    });

    it("竖列：离线越远位移越小、启动越晚", () => {
      const ripples = computeRipples(grid, "list", 2, 10);
      expect(ripples.get("b")?.dy).toBe(-10);
      expect(ripples.get("b")?.delay).toBe(0);
      expect(ripples.get("a")?.dy).toBeCloseTo(-7, 5);
      expect(ripples.get("a")?.delay).toBe(24);
      expect(ripples.get("c")?.dy).toBe(10);
      expect(ripples.get("d")?.dy).toBeCloseTo(7, 5);
      expect(ripples.get("d")?.delay).toBe(24);
    });

    it("网格跨行：上面的行上移、下面的行下移", () => {
      const ripples = computeRipples(grid, "grid", 2, 10);
      expect(ripples.get("a")?.dy).toBe(-10);
      expect(ripples.get("b")?.dy).toBe(-10);
      expect(ripples.get("c")?.dy).toBe(10);
      expect(ripples.get("d")?.dy).toBe(10);
    });

    it("网格行内：只推开同一行的两个项", () => {
      const ripples = computeRipples(grid, "grid", 3, 10);
      expect(ripples.get("c")?.dx).toBe(-10);
      expect(ripples.get("d")?.dx).toBe(10);
      expect(ripples.has("a")).toBe(false);
      expect(ripples.has("b")).toBe(false);
    });
  });

  describe("插入位置判定", () => {
    it("横排按横向中线判定", () => {
      expect(findGapIndex(grid, "row", 10, 30)).toBe(0);
      expect(findGapIndex(grid, "row", 150, 30)).toBe(1);
      expect(findGapIndex(grid, "row", 300, 30)).toBe(4);
    });

    it("竖列按纵向中线判定", () => {
      expect(findGapIndex(grid, "list", 10, 10)).toBe(0);
      expect(findGapIndex(grid, "list", 10, 90)).toBe(2);
      expect(findGapIndex(grid, "list", 10, 200)).toBe(4);
    });

    it("网格先定行再定列", () => {
      expect(findGapIndex(grid, "grid", 10, 10)).toBe(0);
      expect(findGapIndex(grid, "grid", 150, 10)).toBe(1);
      expect(findGapIndex(grid, "grid", 10, 90)).toBe(2);
      expect(findGapIndex(grid, "grid", 150, 90)).toBe(3);
      expect(findGapIndex(grid, "grid", 300, 90)).toBe(4);
    });
  });

  describe("顺序写入", () => {
    it("把项插到指定位置并保持其余顺序", () => {
      expect(insertAt(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
      expect(insertAt(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
      expect(insertAt(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
    });
  });
});
