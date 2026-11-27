import { z } from 'zod';

export const repositorySchema = z
  .string()
  .trim()
  .min(1, '缺少仓库名')
  .max(300, '仓库名过长')
  .refine((value) => /^[^/\s]+\/[^/\s]+$/.test(value), '仓库名必须是 owner/repo 形式');

export const nonEmptyTextSchema = z.string().trim().min(1, '内容不能为空');
export const branchSchema = z.string().trim().min(1, '分支名不能为空').max(255);
export const issueNumberSchema = z.number().int().positive();
export const searchSchema = z.string().trim().min(1).max(500);
export const cursorSchema = z.string().trim().min(1).max(4096);
export const limitSchema = (max = 100) =>
  z.number().int().min(1).max(max);
export const stateSchema = z.enum(['open', 'closed']);

export const paginationShape = {
  limit: limitSchema(100).optional(),
  cursor: cursorSchema.optional(),
};

export function strictObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}
