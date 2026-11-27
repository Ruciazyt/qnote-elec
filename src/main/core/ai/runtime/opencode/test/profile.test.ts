// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildAgentProfile,
  buildCodeAgentProfile,
  QNOTE_AGENT_NAME,
  QNOTE_CODE_AGENT_NAME,
  QNOTE_CODE_TOOL_PERMISSIONS,
  QNOTE_TOOL_PREFIX,
} from "../profile";

describe("opencode agent profile", () => {
  it("默认只放行 QNote 自家工具", () => {
    const profile = buildAgentProfile();
    expect(profile.agentName).toBe(QNOTE_AGENT_NAME);
    expect(profile.markdown).toContain('  "*": deny');
    expect(profile.markdown).toContain(`  "${QNOTE_TOOL_PREFIX}*": allow`);
  });

  it("输出 frontmatter + 正文", () => {
    const markdown = buildAgentProfile({ systemPrompt: "你是助手" }).markdown;
    expect(markdown.startsWith("---\n")).toBe(true);
    expect(markdown).toContain("mode: primary");
    expect(markdown).toContain("你是助手");
    expect(markdown).toContain("steps: 40");
  });

  it("自定义系统提示词时替换正文", () => {
    const markdown = buildAgentProfile({ systemPrompt: "只说一句话" }).markdown;
    expect(markdown).toContain("只说一句话");
    expect(markdown).not.toContain("你是 QNote 桌面应用的 AI 助手");
  });
});

describe("opencode 代码 agent profile", () => {
  it("默认挡掉所有工具，再逐项放开代码工具", () => {
    const profile = buildCodeAgentProfile({ systemPrompt: "测试提示" });
    expect(profile.agentName).toBe(QNOTE_CODE_AGENT_NAME);

    const frontmatter = profile.markdown.split("---")[1] ?? "";
    expect(frontmatter).toContain('"*": deny');
    for (const tool of QNOTE_CODE_TOOL_PERMISSIONS) {
      expect(frontmatter).toContain(`"${tool}": allow`);
    }
    expect(frontmatter).toContain('"external_directory": deny');
    expect(frontmatter).toContain('"qnote_*": allow');
  });

  it("deny 必须写在 allow 前面，否则放行不生效", () => {
    const frontmatter =
      buildCodeAgentProfile({ systemPrompt: "x" }).markdown.split("---")[1] ?? "";
    expect(frontmatter.indexOf('"*": deny')).toBeLessThan(
      frontmatter.indexOf('"bash": allow')
    );
    expect(frontmatter.indexOf('"*": deny')).toBeLessThan(
      frontmatter.indexOf('"qnote_*": allow')
    );
  });

  it("提示词里写明 shell 是 PowerShell", () => {
    const markdown = buildCodeAgentProfile({ systemPrompt: "x" }).markdown;
    expect(markdown).toContain("PowerShell");
    expect(markdown).toContain("分号");
    expect(markdown).toContain("&&");
  });
});
