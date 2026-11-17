
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
  model?: string;
}

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
  claude: 'claude-3-5-haiku-20241022',
};

export const DEFAULT_MAX_TOKENS: Record<AiProvider, number> = {
  openai: 65536,
  deepseek: 65536,
  claude: 8192,
};

export const DEFAULT_TEMPERATURE = 0.7;