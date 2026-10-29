/**
 * 工具注册表
 *
 * 工具全部默认启用。对内嵌浏览器写操作这类用户几乎从不需要关的能力，
 * 开关只是决策负担。
 *
 * 真正的安全边界不在开关上，而在：
 *   1. 只操作用户当前正在看的那个标签页，不新建 / 不关闭标签（见 browserAutomation）
 *   2. 每次操作落应用日志（见 browser/shared.ts 的 runAction）
 *   3. 系统提示词禁止代替用户输入密码 / 验证码 / 支付信息，
 *      提交类操作（下单 / 删除 / 发帖）必须先取得用户确认
 *
 * 尚未实现：写操作的**弹窗二次确认**。
 *   目前的替代是提示词层面的约束。真正的硬确认需要主进程 ↔ 渲染进程
 *   的阻塞式 IPC 往返，等有实际误操作案例再做。
 *
 * 被移除的笔记类工具（历史）：
 *   - search_notes  → 剪贴板历史已有独立的 get_clipboard_history 工具
 *   - create_note   → 旧实现往 note 表（剪贴板自动入库的表）写，会污染那条数据流。
 *                      笔记现已改为纯文件制，AI 写入走 save_note + NoteStore，
 *                      不再触碰 note 表。
 *   - append_todo   → todo 是用户的个人行动清单，AI 不应代写
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import { getClipboardHistoryTool } from './getClipboard';
import { getTodosTool } from './getTodos';
import { getAppInfoTool } from './getAppInfo';
import { saveNoteTool } from './saveNote';
import { listNotesTool } from './listNotes';
import { readNoteTool } from './readNote';
import { rememberTool, recallTool, forgetTool } from './memoryTools';
import { browserGetSnapshotTool } from './browser/browserSnapshot';
import { browserClickTool } from './browser/browserClick';
import { browserFillTool } from './browser/browserFill';
import { browserNavigateTool } from './browser/browserNavigate';

/** 只读工具 — 不改变用户数据 */
export const READ_TOOLS: StructuredToolInterface[] = [
  getClipboardHistoryTool,
  getTodosTool,
  getAppInfoTool,
  listNotesTool,
  readNoteTool,
  recallTool,
  browserGetSnapshotTool,
];

/**
 * 写工具 — 会改变用户数据
 *
 * save_note 写的是用户笔记目录，需要 ToolContext.notes（FileWriter）才能拿到根目录。
 * 它不做覆盖：同名文件自动追加后缀，避免 AI 重试冲掉用户已编辑的版本。
 *
 * remember / forget 改的是 AI 自己的长期记忆（<userData>/ai-memory.json），
 * 不碰用户的剪贴板或笔记。记忆是 AI 主动写入的，所以提示词对它有明确约束：
 * 只记稳定信息，不记敏感信息（见 agentSystem.ts）。
 */
export const WRITE_TOOLS: StructuredToolInterface[] = [
  saveNoteTool,
  rememberTool,
  forgetTool,
  browserClickTool,
  browserFillTool,
  browserNavigateTool,
];

/** AI 可用工具全集 — 全部默认启用 */
export function getEnabledTools(): StructuredToolInterface[] {
  return [...READ_TOOLS, ...WRITE_TOOLS];
}

/** 所有工具名字清单 */
export const ALL_TOOL_NAMES = getEnabledTools().map((t) => t.name);
