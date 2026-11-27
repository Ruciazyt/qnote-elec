import { tool } from "../../tool";
import { z } from 'zod';
import { GitlabApiError, gitlabRequest } from '../api/client';
import { gitlabEndpoints } from '../api/endpoints';
import {
  clampLimit,
  listWithCursor,
  requireProject,
  requireWritable,
  runGitlabTool,
  toGitlabStateEvent,
} from '../utils/helpers';
import { guardBotContent } from '../utils/triggerGuard';
import type { GitlabMergeRequest } from '../api/types';
import {
  branchSchema,
  issueIidSchema,
  paginationShape,
  projectSchema,
  stateSchema,
  strictObject,
} from '../schemas/input';

export const gitlabListMergeRequestsTool = tool(
  async (input: {
    project: string;
    state?: 'opened' | 'closed' | 'merged' | 'all';
    limit?: number;
    cursor?: string;
  }) => {
    return runGitlabTool('gitlab_list_merge_requests', input.project, async () => {
      const project = requireProject(input.project);
      const limit = clampLimit(input.limit, 20, 100);
      const page = await listWithCursor<GitlabMergeRequest>({
        kind: 'mrs',
        path: gitlabEndpoints.mergeRequests(project),
        query: {
          state: input.state ?? 'opened',
          order_by: 'updated_at',
          sort: 'desc',
        },
        cursor: input.cursor,
        perPage: limit,
      });
      const mergeRequests = page.items.map((item) => ({
        iid: item.iid,
        title: item.title,
        state: item.state,
        source_branch: item.source_branch,
        target_branch: item.target_branch,
        draft: item.draft === true,
        merge_status: item.detailed_merge_status ?? item.merge_status ?? null,
        updated_at: item.updated_at ?? null,
        url: item.web_url ?? null,
      }));
      return {
        count: mergeRequests.length,
        total: page.total,
        merge_requests: mergeRequests,
        next_cursor: page.nextCursor,
        next_hint: page.nextCursor
          ? '还有更多 MR，把 next_cursor 原样传回本工具即可继续取下一页'
          : null,
      };
    });
  },
  {
    name: 'gitlab_list_merge_requests',
    description:
      '列出项目里的 Merge Request，返回 iid、标题、状态、源/目标分支、是否可合并。' +
      '要合并或改 MR，先用 gitlab_list_merge_requests 拿到 iid 和当前状态。',
    schema: strictObject({
      project: projectSchema.describe('项目路径，形如 组名/项目名'),
      state: z.enum(['opened', 'closed', 'merged', 'all']).optional().describe('状态过滤，默认 opened'),
      ...paginationShape,
    }),
  }
);

export const gitlabCreateMergeRequestTool = tool(
  async (input: {
    project: string;
    source_branch: string;
    target_branch: string;
    title: string;
    description?: string;
    remove_source_branch?: boolean;
    squash?: boolean;
    dry_run?: boolean;
  }) => {
    return runGitlabTool('gitlab_create_merge_request', input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();
      const source = (input.source_branch ?? '').trim();
      const target = (input.target_branch ?? '').trim();
      const title = (input.title ?? '').trim();
      if (!source) throw new GitlabApiError('缺少源分支 source_branch', 0, false);
      if (!target) throw new GitlabApiError('缺少目标分支 target_branch', 0, false);
      if (!title) throw new GitlabApiError('缺少 MR 标题', 0, false);
      if (source === target) throw new GitlabApiError('源分支和目标分支不能相同', 0, false);
      const guardedTitle = guardBotContent(title, 'MR 标题');
      if (guardedTitle.blocked) {
        throw new GitlabApiError(guardedTitle.message ?? '内容被发送前检查拦截', 0, false);
      }
      const guardedDescription =
        input.description === undefined
          ? undefined
          : guardBotContent(input.description, 'MR 描述');
      if (guardedDescription?.blocked) {
        throw new GitlabApiError(guardedDescription.message ?? '内容被发送前检查拦截', 0, false);
      }
      const removedWords = [...guardedTitle.removed, ...(guardedDescription?.removed ?? [])];
      if (input.dry_run) {
        return {
          dry_run: true,
          project,
          source_branch: source,
          target_branch: target,
          title: guardedTitle.text,
          message: '演练模式：只返回将要创建的 MR，没有真的创建',
          ...(removedWords.length ? { trigger_words_removed: removedWords } : {}),
        };
      }
      const result = await gitlabRequest<GitlabMergeRequest>({
        method: 'POST',
        path: gitlabEndpoints.mergeRequests(project),
        body: {
          source_branch: source,
          target_branch: target,
          title: guardedTitle.text,
          description: guardedDescription?.text,
          remove_source_branch: input.remove_source_branch,
          squash: input.squash,
        },
      });
      return {
        project,
        iid: result.data?.iid ?? null,
        title: result.data?.title ?? guardedTitle.text,
        state: result.data?.state ?? null,
        url: result.data?.web_url ?? null,
        ...(removedWords.length ? { trigger_words_removed: removedWords } : {}),
      };
    });
  },
  {
    name: 'gitlab_create_merge_request',
    description:
      '为某个 feature/fix 分支创建 Merge Request。写操作，创建前先跟用户确认源分支、目标分支和标题。',
    schema: strictObject({
      project: projectSchema.describe('项目路径，形如 组名/项目名'),
      source_branch: branchSchema.describe('源分支（改动所在分支）'),
      target_branch: branchSchema.describe('目标分支（通常是 main/master/develop）'),
      title: z.string().trim().min(1).max(500).describe('MR 标题'),
      description: z.string().optional().describe('MR 描述，可选'),
      remove_source_branch: z.boolean().optional().describe('合并后是否删除源分支'),
      squash: z.boolean().optional().describe('是否把提交压成一个'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要创建的 MR，不真的创建，默认 false'),
    }),
  }
);

export const gitlabUpdateMergeRequestTool = tool(
  async (input: {
    project: string;
    iid: number;
    title?: string;
    description?: string;
    target_branch?: string;
    state?: 'opened' | 'closed';
    dry_run?: boolean;
  }) => {
    return runGitlabTool('gitlab_update_merge_request', input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();
      const iid = Number(input.iid);
      if (!Number.isFinite(iid)) {
        throw new GitlabApiError('缺少 MR 的 iid（先用 gitlab_list_merge_requests 拿到）', 0, false);
      }
      const body: Record<string, unknown> = {};
      const removedWords: string[] = [];
      if (input.title !== undefined) {
        const guarded = guardBotContent(input.title.trim(), 'MR 标题');
        if (guarded.blocked) {
          throw new GitlabApiError(guarded.message ?? '内容被发送前检查拦截', 0, false);
        }
        body.title = guarded.text;
        removedWords.push(...guarded.removed);
      }
      if (input.description !== undefined) {
        const guarded = guardBotContent(input.description, 'MR 描述');
        if (guarded.blocked) {
          throw new GitlabApiError(guarded.message ?? '内容被发送前检查拦截', 0, false);
        }
        body.description = guarded.text;
        removedWords.push(...guarded.removed);
      }
      if (input.target_branch !== undefined) body.target_branch = input.target_branch.trim();
      if (input.state !== undefined) body.state_event = toGitlabStateEvent(input.state);
      if (!Object.keys(body).length) {
        throw new GitlabApiError('没有要改的字段', 0, false);
      }
      if (input.dry_run) {
        return {
          dry_run: true,
          project,
          iid,
          changes: body,
          message: '演练模式：只返回将要修改的字段，没有真的改动',
        };
      }
      const result = await gitlabRequest<GitlabMergeRequest>({
        method: 'PUT',
        path: gitlabEndpoints.mergeRequest(project, iid),
        body,
      });
      if (input.state !== undefined && result.data?.state !== input.state) {
        throw new GitlabApiError(
          `Merge Request 状态更新未生效：期望 ${input.state}，实际 ${result.data?.state ?? '未知'}`,
          result.data ? 200 : 0,
          false
        );
      }
      return {
        project,
        iid: result.data?.iid ?? iid,
        title: result.data?.title ?? null,
        state: result.data?.state ?? null,
        source_branch: result.data?.source_branch ?? null,
        target_branch: result.data?.target_branch ?? null,
        updated_at: result.data?.updated_at ?? null,
        url: result.data?.web_url ?? null,
        changes: body,
        ...(removedWords.length ? { trigger_words_removed: removedWords } : {}),
      };
    });
  },
  {
    name: 'gitlab_update_merge_request',
    description:
      '改 Merge Request 的标题、描述、目标分支或状态。写操作，改之前先读当前状态、跟用户确认。',
    schema: strictObject({
      project: projectSchema.describe('项目路径，形如 组名/项目名'),
      iid: issueIidSchema.describe('MR 的 iid，来自 gitlab_list_merge_requests'),
      title: z.string().trim().min(1).max(500).optional().describe('新标题'),
      description: z.string().optional().describe('新描述'),
      target_branch: branchSchema.optional().describe('新目标分支'),
      state: stateSchema.optional().describe('目标状态；内部转换为 GitLab state_event'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要修改的字段，不真的改动，默认 false'),
    }),
  }
);

export const gitlabMergeMergeRequestTool = tool(
  async (input: {
    project: string;
    iid: number;
    sha?: string;
    remove_source_branch?: boolean;
    dry_run?: boolean;
  }) => {
    return runGitlabTool('gitlab_merge_merge_request', input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();
      const iid = Number(input.iid);
      if (!Number.isFinite(iid)) {
        throw new GitlabApiError('缺少 MR 的 iid（先用 gitlab_list_merge_requests 拿到）', 0, false);
      }
      const current = await gitlabRequest<GitlabMergeRequest>({
        method: 'GET',
        path: gitlabEndpoints.mergeRequest(project, iid),
        idempotent: true,
      });
      const mergeStatus =
        current.data?.detailed_merge_status ?? current.data?.merge_status ?? null;
      if (current.data?.state && current.data.state !== 'opened') {
        throw new GitlabApiError(
          'MR 当前状态是 ' + current.data.state + '，不能再合并',
          0,
          false
        );
      }
      if (
        mergeStatus &&
        mergeStatus !== 'mergeable' &&
        mergeStatus !== 'can_be_merged' &&
        mergeStatus !== 'unchecked'
      ) {
        throw new GitlabApiError(
          'MR 现在不可合并（状态：' + mergeStatus + '），先解决冲突、补提交或等流水线通过',
          0,
          false
        );
      }
      if (input.dry_run) {
        return {
          dry_run: true,
          project,
          iid,
          merge_status: mergeStatus,
          message: '演练模式：只返回将要执行的合并，没有真的合并',
        };
      }
      const result = await gitlabRequest<{
        state?: string;
        merge_commit_sha?: string;
        sha?: string;
      }>({
        method: 'PUT',
        path: gitlabEndpoints.mergeMergeRequest(project, iid),
        body: {
          sha: input.sha,
          should_remove_source_branch: input.remove_source_branch,
        },
      });
      return {
        project,
        iid,
        merged: result.data?.state === 'merged',
        state: result.data?.state ?? null,
        merge_commit_sha: result.data?.merge_commit_sha ?? null,
        url: current.data?.web_url ?? null,
      };
    });
  },
  {
    name: 'gitlab_merge_merge_request',
    description:
      '合并一个 Merge Request。合并前会先检查 MR 状态与可合并性，不通过会直接告诉你原因。' +
      '这是会改变仓库的操作，必须先跟用户明确确认再执行。',
    schema: strictObject({
      project: projectSchema.describe('项目路径，形如 组名/项目名'),
      iid: issueIidSchema.describe('MR 的 iid，来自 gitlab_list_merge_requests'),
      sha: z.string().optional().describe('期望合并的 head SHA，防止合错版本'),
      remove_source_branch: z.boolean().optional().describe('合并后是否删除源分支'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只检查可合并性，不真的合并，默认 false'),
    }),
  }
);
