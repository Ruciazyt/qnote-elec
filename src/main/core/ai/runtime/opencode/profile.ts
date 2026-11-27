import { AGENT_SYSTEM_TEXT } from "../../prompts/agentSystem";
import {
  QNOTE_MCP_SERVER_NAME,
  QNOTE_MCP_TOOL_PREFIX,
} from "../../../../../shared/ai/tools";

export const QNOTE_AGENT_NAME = "qnote";
export const QNOTE_CODE_AGENT_NAME = "qnote-code";
export { QNOTE_MCP_SERVER_NAME };
export const QNOTE_TOOL_PREFIX = QNOTE_MCP_TOOL_PREFIX;
export const QNOTE_AGENT_MAX_STEPS = 40;

export const QNOTE_CODE_TOOL_PERMISSIONS = [
  "bash",
  "read",
  "write",
  "edit",
  "glob",
  "grep",
] as const;

const TOOL_NAMING_NOTE = `## 工具命名

运行时 QNote 工具都带 \`${QNOTE_TOOL_PREFIX}\` 前缀，上面清单里的 get_todos 实际叫 \`${QNOTE_TOOL_PREFIX}get_todos\`，调用时必须用带前缀的全名。`;

export interface AgentProfileOptions {
  systemPrompt?: string;
  maxSteps?: number;
}

export interface AgentProfile {
  agentName: string;
  markdown: string;
}

export function buildAgentProfile(options: AgentProfileOptions = {}): AgentProfile {
  const prompt = (options.systemPrompt ?? AGENT_SYSTEM_TEXT).trim();
  const steps = options.maxSteps ?? QNOTE_AGENT_MAX_STEPS;
  const markdown = [
    "---",
    "description: QNote 桌面应用内置 AI 助手",
    "mode: primary",
    `steps: ${steps}`,
    "permission:",
    '  "*": deny',
    `  "${QNOTE_TOOL_PREFIX}*": allow`,
    "---",
    "",
    prompt,
    "",
    TOOL_NAMING_NOTE,
    "",
  ].join("\n");
  return { agentName: QNOTE_AGENT_NAME, markdown };
}

const CODE_SHELL_NOTE = `## Shell 环境

这台机器是 Windows，\`bash\` 工具实际执行的是 Windows PowerShell 5.1，不是 GNU bash。

- 串联命令用分号 \`;\`，不要用 \`&&\`（PowerShell 5.1 不支持）
- 用 \`Get-ChildItem\` / \`Get-Content\` / \`Select-String\`，没有 \`ls -a\` / \`cat\` / \`grep -r\`
- 路径是 Windows 形式，跨盘符不要用 \`/\` 起头
`;

export function buildCodeAgentProfile(options: AgentProfileOptions = {}): AgentProfile {
  const prompt = (options.systemPrompt ?? AGENT_SYSTEM_TEXT).trim();
  const steps = options.maxSteps ?? QNOTE_AGENT_MAX_STEPS;
  const markdown = [
    "---",
    "description: QNote 代码任务代理",
    "mode: primary",
    `steps: ${steps}`,
    "permission:",
    '  "*": deny',
    ...QNOTE_CODE_TOOL_PERMISSIONS.map((tool) => `  "${tool}": allow`),
    '  "external_directory": deny',
    `  "${QNOTE_TOOL_PREFIX}*": allow`,
    "---",
    "",
    prompt,
    "",
    CODE_SHELL_NOTE,
    "",
    TOOL_NAMING_NOTE,
    "",
  ].join("\n");
  return { agentName: QNOTE_CODE_AGENT_NAME, markdown };
}
