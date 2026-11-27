
export type AiProvider = 'openai' | 'deepseek' | 'claude';

/**
 * 归一化后的 provider：deepseek 走 OpenAI 兼容协议，被并进 openai，
 * 所以按协议分派的默认值只有这两项。
 */
export type NormalizedProvider = 'openai' | 'claude';

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
  model?: string;
}

export const DEFAULT_MODELS: Record<NormalizedProvider, string> = {
  openai: 'gpt-4o-mini',
  claude: 'claude-3-5-haiku-20241022',
};

export const DEFAULT_MAX_TOKENS: Record<NormalizedProvider, number> = {
  openai: 65536,
  claude: 8192,
};

export const DEFAULT_TEMPERATURE = 0.7;