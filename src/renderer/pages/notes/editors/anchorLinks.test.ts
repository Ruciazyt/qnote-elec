import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import {
  slugifyHeading,
  normalizeAnchorId,
  collectHeadingAnchors,
  findHeadingAnchor,
} from "./anchorLinks";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    heading: { content: "inline*", group: "block", attrs: { level: { default: 1 } } },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
});

function buildDoc() {
  return schema.node("doc", null, [
    schema.node("heading", { level: 1 }, [schema.text("目标标题")]),
    schema.node("paragraph", null, [schema.text("正文")]),
    schema.node("heading", { level: 2 }, [schema.text("Second Heading")]),
    schema.node("heading", { level: 2 }, [schema.text("Second Heading")]),
  ]);
}

describe("标题锚点", () => {
  it("标题转成锚点 id", () => {
    expect(slugifyHeading("Second Heading")).toBe("second-heading");
    expect(slugifyHeading("目标标题")).toBe("目标标题");
    expect(slugifyHeading("  Title!  ")).toBe("title");
  });

  it("锚点还原成 id", () => {
    expect(normalizeAnchorId("#abc")).toBe("abc");
    expect(normalizeAnchorId("#%E7%9B%AE%E6%A0%87%E6%A0%87%E9%A2%98")).toBe("目标标题");
    expect(normalizeAnchorId("#a%b")).toBe("a%b");
  });

  it("收集标题锚点，重名标题带序号", () => {
    const anchors = collectHeadingAnchors(buildDoc());
    expect(anchors.map((a) => a.id)).toEqual(["目标标题", "second-heading", "second-heading-1"]);
  });

  it("按锚点找到标题位置", () => {
    const doc = buildDoc();
    expect(findHeadingAnchor(doc, "#目标标题")?.id).toBe("目标标题");
    expect(findHeadingAnchor(doc, "#%E7%9B%AE%E6%A0%87%E6%A0%87%E9%A2%98")?.id).toBe("目标标题");
    expect(findHeadingAnchor(doc, "#second-heading-1")?.id).toBe("second-heading-1");
    expect(findHeadingAnchor(doc, "#找不到")).toBeNull();
  });
});
