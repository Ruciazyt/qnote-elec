import { tool } from "../../tool";
import { z } from 'zod';
import { GitlabApiError, gitlabRequest } from '../api/client';
import { gitlabEndpoints } from '../api/endpoints';
import { clampLimit, listWithCursor, requireProject, requireWritable, runGitlabTool } from '../utils/helpers';
import { checkBranchName } from '../utils/guards';
import type { GitlabBranch, GitlabProject } from '../api/types';
import {
  branchSchema,
  paginationShape,
  projectSchema,
  searchSchema,
  strictObject,
} from '../schemas/input';

export const gitlabListProjectsTool = tool(
  async (input: { search?: string; limit?: number; cursor?: string }) => {
    return runGitlabTool('gitlab_list_projects', undefined, async () => {
      const limit = clampLimit(input.limit, 20, 100);
      const page = await listWithCursor<GitlabProject>({
        kind: 'projects',
        path: gitlabEndpoints.projects(),
        query: {
          search: input.search?.trim() || undefined,
          membership: true,
          order_by: 'last_activity_at',
        },
        cursor: input.cursor,
        perPage: limit,
      });
      const projects = page.items.map((item) => ({
        id: item.id,
        path: item.path_with_namespace,
        default_branch: item.default_branch ?? null,
        last_activity_at: item.last_activity_at ?? null,
        visibility: item.visibility ?? null,
        url: item.web_url ?? null,
      }));
      return {
        count: projects.length,
        total: page.total,
        projects,
        next_cursor: page.nextCursor,
        next_hint: page.nextCursor
          ? '还有更多结果，把 next_cursor 原样传回本工具即可继续取下一页'
          : null,
      };
    });
  },
  {
    name: 'gitlab_list_projects',
    description:
      '列出当前账号可见的 GitLab 项目（只含有成员关系的），返回项目路径、默认分支、最后活跃时间。' +
      '后面所有 GitLab 工具的 project 参数都要用这里或分支列表里出现的项目路径（形如 组名/项目名），不要自己编。',
    schema: strictObject({
      search: searchSchema.optional().describe('按项目名搜索，可选'),
      ...paginationShape,
    }),
  }
);

export const gitlabListBranchesTool = tool(
  async (input: { project: string; search?: string; limit?: number; cursor?: string }) => {
    return runGitlabTool('gitlab_list_branches', input.project, async () => {
      const project = requireProject(input.project);
      const limit = clampLimit(input.limit, 20, 100);
      const page = await listWithCursor<GitlabBranch>({
        kind: 'branches',
        path: gitlabEndpoints.branches(project),
        query: { search: input.search?.trim() || undefined },
        cursor: input.cursor,
        perPage: limit,
      });
      const branches = page.items.map((item) => ({
        name: item.name,
        protected: item.protected === true,
        default: item.default === true,
        head_sha: item.commit?.id ?? null,
        head_title: item.commit?.title ?? null,
        head_time: item.commit?.committed_date ?? null,
      }));
      return {
        count: branches.length,
        total: page.total,
        branches,
        next_cursor: page.nextCursor,
        next_hint: page.nextCursor
          ? '还有更多分支，把 next_cursor 原样传回本工具即可继续取下一页'
          : null,
      };
    });
  },
  {
    name: 'gitlab_list_branches',
    description:
      '列出某个项目的分支，返回分支名、是否受保护、是否默认分支、头提交 SHA。' +
      '提交改动前先用它确认目标分支存在，且不是受保护分支或默认分支。',
    schema: strictObject({
      project: projectSchema.describe('项目路径，形如 组名/项目名（也可填数字项目 ID）'),
      search: searchSchema.optional().describe('按分支名过滤，可选'),
      ...paginationShape,
    }),
  }
);

export const gitlabCreateBranchTool = tool(
  async (input: { project: string; branch: string; ref: string; dry_run?: boolean }) => {
    return runGitlabTool('gitlab_create_branch', input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();
      const branch = (input.branch ?? '').trim();
      const branchProblem = checkBranchName(branch);
      if (branchProblem) throw new GitlabApiError(branchProblem, 0, false);
      const ref = (input.ref ?? '').trim();
      if (!ref) throw new GitlabApiError('缺少基准分支 ref（要从哪个分支拉出新分支）', 0, false);
      if (input.dry_run) {
        return {
          dry_run: true,
          project,
          branch,
          ref,
          message: '演练模式：只返回将要执行的动作，没有真的创建分支',
        };
      }
      const result = await gitlabRequest<{ name?: string; commit?: { id?: string } }>({
        method: 'POST',
        path: gitlabEndpoints.branches(project),
        body: { branch, ref },
      });
      return {
        project,
        branch: result.data?.name ?? branch,
        ref,
        head_sha: result.data?.commit?.id ?? null,
      };
    });
  },
  {
    name: 'gitlab_create_branch',
    description:
      '在项目里创建新分支。分支名必须以 feature/ 或 fix/ 开头（护栏硬性要求），ref 填基准分支。' +
      '分支已存在会报冲突，先用 gitlab_list_branches 确认。写操作，动手前先跟用户确认。',
    schema: strictObject({
      project: projectSchema.describe('项目路径，形如 组名/项目名'),
      branch: branchSchema.describe('新分支名，必须以 feature/ 或 fix/ 开头'),
      ref: branchSchema.describe('基准分支，新分支从这个分支拉出来'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要执行的动作，不真的创建，默认 false'),
    }),
  }
);

export const gitlabDeleteBranchTool = tool(
  async (input: { project: string; branch: string; dry_run?: boolean }) => {
    return runGitlabTool('gitlab_delete_branch', input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();
      const branch = (input.branch ?? '').trim();
      if (!branch) throw new GitlabApiError('缺少分支名', 0, false);
      const info = await gitlabRequest<GitlabBranch>({
        method: 'GET',
        path: gitlabEndpoints.branch(project, branch),
        idempotent: true,
      });
      if (info.data?.default) {
        throw new GitlabApiError('不能删除默认分支「' + branch + '」', 0, false);
      }
      if (info.data?.protected) {
        throw new GitlabApiError('分支「' + branch + '」受保护，不能删除', 0, false);
      }
      if (input.dry_run) {
        return {
          dry_run: true,
          project,
          branch,
          message: '演练模式：只返回将要执行的动作，没有真的删除分支',
        };
      }
      await gitlabRequest({
        method: 'DELETE',
        path: gitlabEndpoints.branch(project, branch),
      });
      return { project, branch, deleted: true };
    });
  },
  {
    name: 'gitlab_delete_branch',
    description:
      '删除项目里的分支。默认分支和受保护分支会被护栏拦下。' +
      '这是破坏性操作，删之前必须先跟用户确认，必要时先用 dry_run 演练。',
    schema: strictObject({
      project: projectSchema.describe('项目路径，形如 组名/项目名'),
      branch: branchSchema.describe('要删除的分支名'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要执行的动作，不真的删除，默认 false'),
    }),
  }
);
