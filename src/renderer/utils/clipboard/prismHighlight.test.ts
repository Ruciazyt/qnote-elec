import { describe, expect, it } from "vitest";
import { highlightClipboardCodes } from "./prismHighlight";

function makeContainer(inner: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = inner;
  return container;
}

describe("highlightClipboardCodes", () => {
  it("高亮带语言标记的代码块", () => {
    const container = makeContainer(
      '<code class="language-javascript" data-prism-lang="javascript">const a = 1;</code>'
    );

    highlightClipboardCodes(container);

    const code = container.querySelector("code");
    expect(code?.innerHTML).toContain("token keyword");
    expect(code?.textContent).toBe("const a = 1;");
  });

  it("没有语言标记的代码块保持原样", () => {
    const container = makeContainer("<code>plain text</code>");

    highlightClipboardCodes(container);

    expect(container.querySelector("code")?.innerHTML).toBe("plain text");
  });

  it("内容没变时不重复高亮", () => {
    const container = makeContainer(
      '<code class="language-javascript" data-prism-lang="javascript">const a = 1;</code>'
    );

    highlightClipboardCodes(container);
    const first = container.querySelector("code")?.innerHTML;

    highlightClipboardCodes(container);

    expect(container.querySelector("code")?.innerHTML).toBe(first);
  });

  it("内容变了会重新高亮", () => {
    const container = makeContainer(
      '<code class="language-javascript" data-prism-lang="javascript">const a = 1;</code>'
    );

    highlightClipboardCodes(container);
    const code = container.querySelector("code");
    if (!code) throw new Error("code 元素缺失");
    code.textContent = "let b = 2;";

    highlightClipboardCodes(container);

    expect(code.innerHTML).toContain("token keyword");
    expect(code.textContent).toBe("let b = 2;");
  });

  it("容器为空时安全返回", () => {
    expect(() => highlightClipboardCodes(null)).not.toThrow();
  });
});
