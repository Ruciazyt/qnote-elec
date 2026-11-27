import { tool } from "../../tool";
import { z } from 'zod';
import { GitlabApiError, gitlabRequest } from '../api/client';
import { gitlabEndpoints } from '../api/endpoints';
import type { GitlabHook } from '../api/types';
import {
  hookIdSchema,
  hookTriggerSchema,
  hookUrlSchema,
  paginationShape,
  projectSchema,
  strictObject,
} from '../schemas/input';
import {
  clampLimit,
  listWithCursor,
  requireProject,
  requireWritable,
  runGitlabTool,
} from '../utils/helpers';

const hookEventShape = {
  push_events: z.boolean().optional(),
  tag_push_events: z.boolean().optional(),
  note_events: z.boolean().optional(),
  issues_events: z.boolean().optional(),
  confidential_issues_events: z.boolean().optional(),
  merge_requests_events: z.boolean().optional(),
  job_events: z.boolean().optional(),
  pipeline_events: z.boolean().optional(),
  wiki_page_events: z.boolean().optional(),
  releases_events: z.boolean().optional(),
};

interface HookInput {
  project: string;
  url?: string;
  token?: string;
  signing_token?: string;
  enable_ssl_verification?: boolean;
  dry_run?: boolean;
  push_events?: boolean;
  tag_push_events?: boolean;
  note_events?: boolean;
  issues_events?: boolean;
  confidential_issues_events?: boolean;
  merge_requests_events?: boolean;
  job_events?: boolean;
  pipeline_events?: boolean;
  wiki_page_events?: boolean;
  releases_events?: boolean;
}

function hookBody(input: HookInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.url !== undefined) body.url = input.url;
  if (input.token !== undefined) body.token = input.token;
  if (input.signing_token !== undefined) body.signing_token = input.signing_token;
  if (input.enable_ssl_verification !== undefined) {
    body.enable_ssl_verification = input.enable_ssl_verification;
  }
  for (const key of Object.keys(hookEventShape) as Array<keyof typeof hookEventShape>) {
    if (input[key] !== undefined) body[key] = input[key];
  }
  return body;
}

function hookResult(hook: GitlabHook) {
  return {
    id: hook.id,
    url: hook.url,
    created_at: hook.created_at ?? null,
    push_events: hook.push_events ?? false,
    tag_push_events: hook.tag_push_events ?? false,
    note_events: hook.note_events ?? false,
    issues_events: hook.issues_events ?? false,
    confidential_issues_events: hook.confidential_issues_events ?? false,
    merge_requests_events: hook.merge_requests_events ?? false,
    job_events: hook.job_events ?? false,
    pipeline_events: hook.pipeline_events ?? false,
    wiki_page_events: hook.wiki_page_events ?? false,
    releases_events: hook.releases_events ?? false,
    enable_ssl_verification: hook.enable_ssl_verification ?? true,
  };
}

export const gitlabListHooksTool = tool(
  async (input: { project: string; limit?: number; cursor?: string }) => {
    return runGitlabTool('gitlab_list_hooks', input.project, async () => {
      const project = requireProject(input.project);
      const page = await listWithCursor<GitlabHook>({
        kind: 'hooks',
        path: gitlabEndpoints.hooks(project),
        query: {},
        cursor: input.cursor,
        perPage: clampLimit(input.limit, 20, 100),
      });
      return {
        count: page.items.length,
        total: page.total,
        hooks: page.items.map(hookResult),
        next_cursor: page.nextCursor,
      };
    });
  },
  {
    name: 'gitlab_list_hooks',
    description: '列出项目的 Webhook，不返回 secret/token，只返回接收地址与事件开关。',
    schema: strictObject({
      project: projectSchema.describe('项目路径或数字项目 ID'),
      ...paginationShape,
    }),
  }
);

export const gitlabCreateHookTool = tool(
  async (input: HookInput) => {
    return runGitlabTool('gitlab_create_hook', input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();
      const body = hookBody(input);
      if (input.dry_run) {
        return {
          dry_run: true,
          project,
          changes: { ...body, token: input.token ? '[已隐藏]' : undefined },
        };
      }
      const result = await gitlabRequest<GitlabHook>({
        method: 'POST',
        path: gitlabEndpoints.hooks(project),
        body,
      });
      return { project, hook: hookResult(result.data) };
    });
  },
  {
    name: 'gitlab_create_hook',
    description:
      '给指定项目创建 Webhook。写操作；url 是接收服务地址，token 是 GitLab 回调时的 X-Gitlab-Token。',
    schema: strictObject({
      project: projectSchema.describe('项目路径或数字项目 ID'),
      url: hookUrlSchema.describe('GitLab 事件接收地址'),
      token: z.string().trim().min(8).max(4096).optional().describe('Webhook secret token'),
      enable_ssl_verification: z.boolean().optional(),
      ...hookEventShape,
      dry_run: z.boolean().optional(),
    }),
  }
);

export const gitlabUpdateHookTool = tool(
  async (input: HookInput & { hook_id: number }) => {
    return runGitlabTool('gitlab_update_hook', input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();
      const body = hookBody(input);
      if (!Object.keys(body).length) {
        throw new GitlabApiError('没有要修改的 Webhook 字段', 0, false);
      }
      if (input.dry_run) {
        return {
          dry_run: true,
          project,
          hook_id: input.hook_id,
          changes: { ...body, token: input.token ? '[已隐藏]' : undefined },
        };
      }
      const result = await gitlabRequest<GitlabHook>({
        method: 'PUT',
        path: gitlabEndpoints.hook(project, input.hook_id),
        body,
      });
      return { project, hook: hookResult(result.data) };
    });
  },
  {
    name: 'gitlab_update_hook',
    description: '更新指定项目 Webhook 的地址、secret 或事件开关。写操作。',
    schema: strictObject({
      project: projectSchema.describe('项目路径或数字项目 ID'),
      hook_id: hookIdSchema.describe('来自 gitlab_list_hooks 的 Webhook id'),
      url: hookUrlSchema.optional().describe('新的事件接收地址'),
      token: z.string().trim().min(8).max(4096).optional().describe('新的 Webhook secret token'),
      enable_ssl_verification: z.boolean().optional(),
      ...hookEventShape,
      dry_run: z.boolean().optional(),
    }),
  }
);

export const gitlabDeleteHookTool = tool(
  async (input: { project: string; hook_id: number; dry_run?: boolean }) => {
    return runGitlabTool('gitlab_delete_hook', input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();
      if (input.dry_run) {
        return { dry_run: true, project, hook_id: input.hook_id };
      }
      await gitlabRequest({
        method: 'DELETE',
        path: gitlabEndpoints.hook(project, input.hook_id),
      });
      return { project, hook_id: input.hook_id, deleted: true };
    });
  },
  {
    name: 'gitlab_delete_hook',
    description: '删除指定项目 Webhook。破坏性操作，先跟用户确认。',
    schema: strictObject({
      project: projectSchema.describe('项目路径或数字项目 ID'),
      hook_id: hookIdSchema.describe('来自 gitlab_list_hooks 的 Webhook id'),
      dry_run: z.boolean().optional(),
    }),
  }
);

export const gitlabTestHookTool = tool(
  async (input: { project: string; hook_id: number; trigger: z.infer<typeof hookTriggerSchema> }) => {
    return runGitlabTool('gitlab_test_hook', input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();
      await gitlabRequest({
        method: 'POST',
        path: gitlabEndpoints.hookTest(project, input.hook_id, input.trigger),
      });
      return { project, hook_id: input.hook_id, trigger: input.trigger, sent: true };
    });
  },
  {
    name: 'gitlab_test_hook',
    description: '让 GitLab 对指定 Webhook 发送一次测试事件，用于确认接收服务可达。',
    schema: strictObject({
      project: projectSchema.describe('项目路径或数字项目 ID'),
      hook_id: hookIdSchema.describe('来自 gitlab_list_hooks 的 Webhook id'),
      trigger: hookTriggerSchema,
    }),
  }
);
