import type { GitlabEvent } from "../events/webhook";

export interface TaskPromptInput {
  event: GitlabEvent;
  instruction: string;
  repoDir: string;
  branch: string;
  defaultBranch: string;
  allowPush: boolean;
}

export function buildTaskPrompt(input: TaskPromptInput): string {
  const lines: string[] = [];
  lines.push("## GitLab 任务");
  lines.push("");
  lines.push(`- 项目：${input.event.projectPath}`);
  if (input.event.mrIid) {
    lines.push(
      `- 合并请求：!${input.event.mrIid}${input.event.title ? ` ${input.event.title}` : ""}`
    );
  } else if (input.event.issueIid) {
    lines.push(
      `- Issue：#${input.event.issueIid}${input.event.title ? ` ${input.event.title}` : ""}`
    );
  }
  if (input.event.author) {
    lines.push(`- 触发人：${input.event.author}`);
  }
  if (input.event.webUrl) {
    lines.push(`- 链接：${input.event.webUrl}`);
  }
  lines.push(`- 本地工作目录：${input.repoDir}`);
  lines.push(
    `- 当前分支：${input.branch}（基于 ${input.defaultBranch}）`
  );
  lines.push("");
  lines.push("## 指令");
  lines.push("");
  lines.push(input.instruction);
  lines.push("");
  lines.push("## 工作方式");
  lines.push("");
  lines.push("- 先读代码再动手，改动范围限定在当前工作目录内");
  lines.push("- 改完跑一遍能跑的检查（构建 / 测试），失败就修到能过");
  lines.push("- 提交信息用中文祈使句，说清改了什么");
  if (input.allowPush) {
    lines.push(
      `- 提交后推送到分支 \`${input.branch}\`，再用 GitLab 工具开合并请求，源分支填 \`${input.branch}\``
    );
  } else {
    lines.push("- 不要推送分支，改动留在本地");
  }
  lines.push(
    "- 完成后用 GitLab 工具把结论评论回原 issue / 合并请求，说明改了什么、验证了什么"
  );
  lines.push(
    "- 项目还没配 webhook 的话，用 GitLab 工具 \"配置 Webhook\" 建一条（地址与密钥 QNote 自动填）"
  );
  lines.push("");
  return lines.join("\n");
}
