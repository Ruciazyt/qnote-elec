import type { ToolDefinition } from "./tool";
import type { BuiltinToolInfo, BuiltinToolKind } from "../../../../shared/ai/tools";
import { QNOTE_MCP_TOOL_PREFIX } from "../../../../shared/ai/tools";
import { getClipboardHistoryTool } from "./getClipboard";
import { getTodosTool } from "./getTodos";
import { createTodoTool, updateTodoTool } from "./todoTools";
import { getAppInfoTool } from "./getAppInfo";
import { saveNoteTool } from "./saveNote";
import { listNotesTool } from "./listNotes";
import { readNoteTool } from "./readNote";
import { rememberTool, recallTool, forgetTool } from "./memoryTools";
import { browserGetSnapshotTool } from "./browser/browserSnapshot";
import { browserClickTool } from "./browser/browserClick";
import { browserFillTool } from "./browser/browserFill";
import { browserNavigateTool } from "./browser/browserNavigate";
import { webSearchTool } from "./web/webSearch";
import { webFetchTool } from "./web/webFetch";
import { GITLAB_READ_TOOLS, GITLAB_WRITE_TOOLS } from "./gitlab/index";
import { GITHUB_READ_TOOLS, GITHUB_WRITE_TOOLS } from "./github/index";

export const READ_TOOLS: ToolDefinition[] = [
  getClipboardHistoryTool,
  getTodosTool,
  getAppInfoTool,
  listNotesTool,
  readNoteTool,
  recallTool,
  browserGetSnapshotTool,
  webSearchTool,
  webFetchTool,
];

export const WRITE_TOOLS: ToolDefinition[] = [
  saveNoteTool,
  createTodoTool,
  updateTodoTool,
  rememberTool,
  forgetTool,
  browserClickTool,
  browserFillTool,
  browserNavigateTool,
];

interface ToolMeta {
  title: string;
  group: string;
  kind: BuiltinToolKind;
}

const META: Record<string, ToolMeta> = {
  list_notes: { title: "列出笔记", group: "笔记", kind: "read" },
  read_note: { title: "读取笔记", group: "笔记", kind: "read" },
  save_note: { title: "保存笔记", group: "笔记", kind: "write" },
  get_todos: { title: "读取待办", group: "待办", kind: "read" },
  create_todo: { title: "新建待办", group: "待办", kind: "write" },
  update_todo: { title: "更新待办", group: "待办", kind: "write" },
  get_clipboard_history: { title: "读取剪贴板历史", group: "剪贴板", kind: "read" },
  recall: { title: "检索记忆", group: "记忆", kind: "read" },
  remember: { title: "写入记忆", group: "记忆", kind: "write" },
  forget: { title: "删除记忆", group: "记忆", kind: "write" },
  web_search: { title: "联网搜索", group: "网页", kind: "read" },
  web_fetch: { title: "抓取网页", group: "网页", kind: "read" },
  browser_get_snapshot: { title: "读取页面快照", group: "浏览器", kind: "read" },
  browser_navigate: { title: "打开网页", group: "浏览器", kind: "write" },
  browser_click: { title: "点击页面元素", group: "浏览器", kind: "write" },
  browser_fill: { title: "填写输入框", group: "浏览器", kind: "write" },
  get_app_info: { title: "读取应用信息", group: "应用", kind: "read" },
  gitlab_list_projects: { title: "列出项目", group: "GitLab", kind: "read" },
  gitlab_list_branches: { title: "列出分支", group: "GitLab", kind: "read" },
  gitlab_list_commits: { title: "列出提交", group: "GitLab", kind: "read" },
  gitlab_list_issues: { title: "列出 Issue", group: "GitLab", kind: "read" },
  gitlab_get_issue: { title: "读取 Issue", group: "GitLab", kind: "read" },
  gitlab_list_merge_requests: { title: "列出合并请求", group: "GitLab", kind: "read" },
  gitlab_list_pipelines: { title: "列出流水线", group: "GitLab", kind: "read" },
  gitlab_get_pipeline: { title: "读取流水线", group: "GitLab", kind: "read" },
  gitlab_get_job_logs: { title: "读取作业日志", group: "GitLab", kind: "read" },
  gitlab_create_branch: { title: "创建分支", group: "GitLab", kind: "write" },
  gitlab_delete_branch: { title: "删除分支", group: "GitLab", kind: "write" },
  gitlab_commit_files: { title: "提交文件", group: "GitLab", kind: "write" },
  gitlab_create_issue: { title: "创建 Issue", group: "GitLab", kind: "write" },
  gitlab_update_issue: { title: "更新 Issue", group: "GitLab", kind: "write" },
  gitlab_add_comment: { title: "添加评论", group: "GitLab", kind: "write" },
  gitlab_create_merge_request: { title: "创建合并请求", group: "GitLab", kind: "write" },
  gitlab_update_merge_request: { title: "更新合并请求", group: "GitLab", kind: "write" },
  gitlab_merge_merge_request: { title: "合并合并请求", group: "GitLab", kind: "write" },
  github_list_repositories: { title: "列出仓库", group: "GitHub", kind: "read" },
  github_list_branches: { title: "列出分支", group: "GitHub", kind: "read" },
  github_list_commits: { title: "列出提交", group: "GitHub", kind: "read" },
  github_list_issues: { title: "列出 Issue", group: "GitHub", kind: "read" },
  github_get_issue: { title: "读取 Issue", group: "GitHub", kind: "read" },
  github_list_pull_requests: { title: "列出合并请求", group: "GitHub", kind: "read" },
  github_list_workflow_runs: { title: "列出工作流运行", group: "GitHub", kind: "read" },
  github_get_workflow_run: { title: "读取工作流运行", group: "GitHub", kind: "read" },
  github_get_job_logs: { title: "读取作业日志", group: "GitHub", kind: "read" },
  github_create_branch: { title: "创建分支", group: "GitHub", kind: "write" },
  github_delete_branch: { title: "删除分支", group: "GitHub", kind: "write" },
  github_commit_files: { title: "提交文件", group: "GitHub", kind: "write" },
  github_create_issue: { title: "创建 Issue", group: "GitHub", kind: "write" },
  github_update_issue: { title: "更新 Issue", group: "GitHub", kind: "write" },
  github_add_comment: { title: "添加评论", group: "GitHub", kind: "write" },
  github_create_pull_request: { title: "创建合并请求", group: "GitHub", kind: "write" },
  github_update_pull_request: { title: "更新合并请求", group: "GitHub", kind: "write" },
  github_merge_pull_request: { title: "合并合并请求", group: "GitHub", kind: "write" },
};

const EXTRA_META: Record<string, ToolMeta> = {
  gitlab_list_hooks: { title: "列出 Webhook", group: "GitLab", kind: "read" },
  gitlab_gateway_status: { title: "网关配置", group: "GitLab", kind: "read" },
  gitlab_create_hook: { title: "创建 Webhook", group: "GitLab", kind: "write" },
  gitlab_ensure_webhook: { title: "配置 Webhook", group: "GitLab", kind: "write" },
  gitlab_update_hook: { title: "更新 Webhook", group: "GitLab", kind: "write" },
  gitlab_delete_hook: { title: "删除 Webhook", group: "GitLab", kind: "write" },
  gitlab_test_hook: { title: "测试 Webhook", group: "GitLab", kind: "write" },
  gitlab_ensure_runner: { title: "配置 Runner 接入", group: "GitLab", kind: "write" },
};

const WRITE_VERBS = [
  "create",
  "update",
  "delete",
  "merge",
  "commit",
  "add",
  "remove",
  "write",
  "set",
];

function inferGroup(name: string): string {
  if (name.startsWith("gitlab_")) return "GitLab";
  if (name.startsWith("github_")) return "GitHub";
  return "其他";
}

function inferKind(name: string): BuiltinToolKind {
  const verb = name.split("_")[1] ?? "";
  return WRITE_VERBS.includes(verb) ? "write" : "read";
}

function firstClause(description: string): string {
  const text = description.trim();
  if (!text) return "";
  const cut = text.search(/[，。；,;]/);
  return cut > 0 ? text.slice(0, cut) : text;
}

export interface BuiltinToolEntry {
  name: string;
  title: string;
  description: string;
  group: string;
  kind: BuiltinToolKind;
}

export function toEntry(tool: ToolDefinition): BuiltinToolEntry {
  const meta = META[tool.name] ?? EXTRA_META[tool.name];
  const description = tool.description ?? "";
  return {
    name: tool.name,
    title: meta?.title ?? (firstClause(description) || tool.name),
    description,
    group: meta?.group ?? inferGroup(tool.name),
    kind: meta?.kind ?? inferKind(tool.name),
  };
}

export const BUILTIN_TOOL_ENTRIES: BuiltinToolEntry[] = [
  ...READ_TOOLS.map(toEntry),
  ...WRITE_TOOLS.map(toEntry),
  ...GITLAB_READ_TOOLS.map(toEntry),
  ...GITLAB_WRITE_TOOLS.map(toEntry),
  ...GITHUB_READ_TOOLS.map(toEntry),
  ...GITHUB_WRITE_TOOLS.map(toEntry),
];

export interface ToolDisplay {
  name: string;
  title: string;
}

/**
 * opencode 给 MCP 工具加的是服务器名前缀，这里还原成 QNote MCP server 里的原名，
 * 并顺带查出界面上显示用的中文标题。
 */
export function resolveToolDisplay(rawName: string): ToolDisplay {
  const bare = rawName.startsWith(QNOTE_MCP_TOOL_PREFIX)
    ? rawName.slice(QNOTE_MCP_TOOL_PREFIX.length)
    : rawName;
  const entry = BUILTIN_TOOL_ENTRIES.find((e) => e.name === bare);
  return { name: entry?.name ?? bare, title: entry?.title ?? "" };
}

export function listBuiltinTools(): BuiltinToolInfo[] {
  return BUILTIN_TOOL_ENTRIES.map(({ name, title, description, group, kind }) => ({
    name,
    title,
    description,
    group,
    kind,
  }));
}
