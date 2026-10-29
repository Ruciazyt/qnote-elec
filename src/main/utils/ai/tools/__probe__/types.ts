/**
 * 工具上下文：在注册工具时由 aiHandlers 注入
 * 工具实现不直接 require DB / handlers，而是通过 ctx 拿到
 */

import type { Knex } from 'knex';
import type { BrowserAutomation } from '../../../core/window/browserAutomation';
import type { FileWriter } from '../../../core/fileWriter';

/** 工具运行时上下文 */
export interface ToolContext {
  DB: Knex;
  /** 当前 AI 配置（用于工具内部需要再调 AI 的场景，目前未用到） */
  aiConfig?: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl?: string;
  };
  /**
   * 内嵌浏览器句柄 — browser_* 工具用它读页面 / 操控页面
   *
   * 为何是可选：Agent 模式之外的对话链路不初始化浏览器。
   * 工具里必须显式判空并返回友好错误，不能假设它一定在。
   */
  browser?: BrowserAutomation;
  /**
   * 笔记目录访问器 — note_* 工具用它解析用户设置的笔记根目录
   *
   * 为什么要注入而不是让工具直接读 settings 表：
   * 笔记根目录的真值在 FileWriter 里（它持有路径并处理未设置时的回退）。
   * 工具若自己查 DB，就会绕开那套回退逻辑，遇到空值时拿到不可用的路径。
   */
  notes?: FileWriter;
}

/** 全局注入：避免每个 tool 都 require('../database') */
let _ctx: ToolContext | null = null;

/**
 * 注入上下文（**增量合并**，不会清掉先前注入的字段）
 *
 * 为什么是 merge 而不是替换：
 *   aiHandlers 有两处调用 —— 启动时注入 DB+browser，
 *   每次 Agent 请求再注入一次 aiConfig。若是整体替换，
 *   第二处漏传 browser 就会让浏览器工具在 Agent 模式下静默失效。
 */
export function setToolContext(ctx: Partial<ToolContext>): void {
  _ctx = { ...(_ctx as ToolContext), ...ctx } as ToolContext;
}

export function getToolContext(): ToolContext {
  if (!_ctx) {
    throw new Error(
      'Tool context not initialized. Call setToolContext() before invoking any tool.'
    );
  }
  return _ctx;
}
