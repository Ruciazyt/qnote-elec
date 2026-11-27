
import type { Knex } from 'knex';
import type { BrowserAutomation } from "../window/browser/browserAutomation";
import type { FileWriter } from "../notes/fileWriter";

export interface ToolContext {
  DB: Knex;
  aiConfig?: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl?: string;
  };
  browser?: BrowserAutomation;
  notes?: FileWriter;
}

let _ctx: ToolContext | null = null;

export function initToolContext(ctx: ToolContext): void {
  _ctx = ctx;
}

export function updateToolContext(ctx: Partial<ToolContext>): void {
  if (!_ctx) {
    throw new Error(
      'Tool context not initialized. Call initToolContext() before updating it.'
    );
  }
  _ctx = { ..._ctx, ...ctx };
}

export function getToolContext(): ToolContext {
  if (!_ctx) {
    throw new Error(
      'Tool context not initialized. Call initToolContext() before invoking any tool.'
    );
  }
  return _ctx;
}
