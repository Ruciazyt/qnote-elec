
import type { AiProvider } from './types';

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigError';
  }
}

export class AiApiError extends Error {
  public readonly status?: number;
  public readonly provider?: AiProvider;

  constructor(
    message: string,
    status?: number,
    provider?: AiProvider
  ) {
    super(message);
    this.name = 'AiApiError';
    this.status = status;
    this.provider = provider;
  }
}