/**
 * get_app_info — 应用信息（版本、数据目录、当前 provider）
 *
 * 用途：AI 自我介绍 / 帮助用户排查问题
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { app } from 'electron';
import { getToolContext } from './types';

export const getAppInfoTool = tool(
  async () => {
    const ctx = getToolContext();
    return JSON.stringify({
      app: {
        name: app.getName(),
        version: app.getVersion(),
        dataPath: app.getPath('userData'),
        isPackaged: app.isPackaged,
        platform: process.platform,
      },
      ai: ctx.aiConfig
        ? {
            provider: ctx.aiConfig.provider,
            model: ctx.aiConfig.model || '(default)',
            hasBaseUrl: !!ctx.aiConfig.baseUrl,
          }
        : null,
    });
  },
  {
    name: 'get_app_info',
    description:
      '返回 QNote 应用版本、数据目录、当前 AI provider/model 等信息。用户问"这个 app 是什么版本"、"数据存哪里"时使用。',
    schema: z.object({}).optional(),
  }
);