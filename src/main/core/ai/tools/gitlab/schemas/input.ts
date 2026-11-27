import { z } from 'zod';

export const projectSchema = z
  .string()
  .trim()
  .min(1, '缺少项目路径')
  .max(500, '项目路径过长');

export const nonEmptyTextSchema = z.string().trim().min(1, '内容不能为空');
export const branchSchema = z.string().trim().min(1, '分支名不能为空').max(255);
export const issueIidSchema = z.number().int().positive();
export const searchSchema = z.string().trim().min(1).max(500);
export const cursorSchema = z.string().trim().min(1).max(4096);
export const limitSchema = (max = 100) =>
  z.number().int().min(1).max(max);
export const stateSchema = z.enum(['opened', 'closed']);
export const hookUrlSchema = z
  .string()
  .trim()
  .url('Webhook 地址不是有效 URL')
  .refine(
    (value) => value.startsWith('http://') || value.startsWith('https://'),
    'Webhook 地址只支持 http:// 或 https://'
  );
export const hookIdSchema = z.number().int().positive();
export const hookTriggerSchema = z.enum([
  'push_events',
  'tag_push_events',
  'note_events',
  'issues_events',
  'confidential_issues_events',
  'merge_requests_events',
  'job_events',
  'pipeline_events',
  'wiki_page_events',
  'releases_events',
]);

export const paginationShape = {
  limit: limitSchema(100).optional(),
  cursor: cursorSchema.optional(),
};

export function strictObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}
