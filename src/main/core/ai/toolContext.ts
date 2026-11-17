
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
