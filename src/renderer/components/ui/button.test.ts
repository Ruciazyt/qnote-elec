import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";


const BUTTON_SOURCE = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "button.tsx"),
  "utf8"
);

function baseClassString(): string {
  const m = BUTTON_SOURCE.match(/const buttonVariants = cva\(\s*"([^"]+)"/);
  if (!m) throw new Error("没找到 buttonVariants 的基类类名");
  return m[1];
}

function baseRingWidth(): number {
  const m = baseClassString().match(/focus-visible:ring-(\d+)/);
  return m ? Number(m[1]) : 0;
}

describe("按钮基类的焦点指示器", () => {
  it("基类的焦点指示器厚度 ≥ 2px（WCAG 2.2 SC 2.4.11）", () => {
    expect(baseRingWidth()).toBeGreaterThanOrEqual(2);
  });
});
