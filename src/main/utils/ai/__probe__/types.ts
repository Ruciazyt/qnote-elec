/**
 * AI 模块共享类型定义
 *
 * 设计原则：保持与旧 `aiService.ts` 的同名类型字段 1:1 兼容，
 * 这样 aiHandlers 等调用方无需任何改动。
 */

/**
 * Provider 枚举。
 * 注意：'deepseek' 是历史遗留值，行为等同于 'openai'（走 OpenAI 兼容协议），
 * 由 providers.normalizeProvider 内部映射。
 */
export type AiProvider = 'openai' | 'deepseek' | 'claude';

export interface AiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface AiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AiResponse {
  content: string;
  usage?: AiUsage;
  /** 实际使用的模型 id（provider 返回的）— 便于调试 */
  model?: string;
}

/** 用户留空 model 时回落到各 provider 的默认值。
 * 'deepseek' 走 OpenAI 兼容协议，沿用 openai 的默认模型（实际不常用）。 */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
  claude: 'claude-3-5-haiku-20241022',
};

/**
 * 各 provider 的默认 max tokens（单次回复的输出上限）
 *
 * 原来是 openai 8000 —— 沿用旧 aiService.ts 的值，一直没调过，实测是个硬伤：
 *  · 思考 token 计入这个预算，MiniMax-M3 又是默认开思考的
 *  · 撞顶时 API 返回 finish_reason="length"，而调用方没读它 → 静默截断，
 *    实测连续三轮输出精确停在 8000
 *  · 更隐蔽的坑：写长笔记时，一个 save_note 的参数本身就有几千 token，
 *    模型「感觉」装不下时就退化成把内容当正文写出来 —— 表现是工具调用根本没发出
 *    （tool_call_chunks 为空），内容全跑进了聊天框而不是笔记文件
 *
 * 官方文档对 MiniMax-M3 的建议值是 128K（上限 512K），其他模型建议 64K。
 * openai/deepseek 取 64K：对这个桌面应用够宽裕，离上限也还有距离。
 * 注意这是**天花板不是配额** —— 模型正常 finish_reason="stop" 时按实际用量计费，
 * 抬高它不会多花钱。
 *
 * claude 只抬到 8192：Anthropic 多数模型的单次输出上限就是 8192
 * （Haiku / Sonnet 3.5 都是），写大了 API 会直接报错。这条路径没实测过，
 * 真要用 Claude 跑长笔记，得先确认所选模型的实际上限再调。
 *
 * 改成调用方传 maxTokens 时可覆盖。
 */
export const DEFAULT_MAX_TOKENS: Record<AiProvider, number> = {
  openai: 65536,
  deepseek: 65536,
  claude: 8192,
};

/** 默认温度 — 旧实现写死 0.7 */
export const DEFAULT_TEMPERATURE = 0.7;