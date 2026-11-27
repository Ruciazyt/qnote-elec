import { tool } from "../../tool";
import { z } from 'zod';
import { GitlabApiError, gitlabRequest } from '../api/client';
import { gitlabEndpoints } from '../api/endpoints';
import { clampLimit, listWithCursor, requireProject, requireWritable, runGitlabTool } from '../utils/helpers';
import { checkWritableBranch } from '../utils/guards';
import type { GitlabBranch, GitlabCommit } from '../api/types';
import { branchSchema, paginationShape, projectSchema, strictObject } from '../schemas/input';

export const gitlabListCommitsTool = tool(
  async (input: { project: string; ref?: string; limit?: number; cursor?: string }) => {
    return runGitlabTool('gitlab_list_commits', input.project, async () => {
      const project = requireProject(input.project);
      const limit = clampLimit(input.limit, 20, 100);
      const page = await listWithCursor<GitlabCommit>({
        kind: 'commits',
        path: gitlabEndpoints.commits(project),
        query: { ref_name: input.ref?.trim() || undefined },
        cursor: input.cursor,
        perPage: limit,
      });
      const commits = page.items.map((item) => ({
        sha: item.short_id || item.id,
        title: item.title,
        author: item.author_name,
        created_at: item.created_at,
        url: item.web_url ?? null,
      }));
      return {
        count: commits.length,
        total: page.total,
        commits,
        next_cursor: page.nextCursor,
        next_hint: page.nextCursor
          ? '还有更多提交，把 next_cursor 原样传回本工具即可继续取下一页'
          : null,
      };
    });
  },
  {
    name: 'gitlab_list_commits',
    description:
      '列出某个项目或分支上的提交，返回短 SHA、标题、作者、时间。' +
      '要看某个提交改了什么，用返回的 sha 配合 gitlab_commit_files 之外的信息，或直接让用户看 diff。',
    schema: strictObject({
      project: projectSchema.describe('项目路径，形如 组名/项目名'),
      ref: branchSchema.optional().describe('只看某个分支的提交，可选'),
      ...paginationShape,
    }),
  }
);

export const gitlabCommitFilesTool = tool(
  async (input: {
    project: string;
    branch: string;
    message: string;
    actions: Array<{
      action: 'create' | 'update' | 'delete' | 'move' | 'chmod';
      file_path: string;
      content?: string;
      last_commit_id?: string;
      previous_path?: string;
    }>;
    dry_run?: boolean;
  }) => {
    return runGitlabTool('gitlab_commit_files', input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();
      const branch = (input.branch ?? '').trim();
      if (!branch) throw new GitlabApiError('缺少目标分支', 0, false);
      const message = (input.message ?? '').trim();
      if (!message) throw new GitlabApiError('缺少提交说明', 0, false);
      const actions = (input.actions ?? []).filter(Boolean);
      if (!actions.length) throw new GitlabApiError('至少要有一个文件改动', 0, false);
      for (const action of actions) {
        if (!action.file_path) throw new GitlabApiError('文件改动缺少 file_path', 0, false);
        if (action.action === 'move' && !action.previous_path) {
          throw new GitlabApiError('move 操作必须给 previous_path', 0, false);
        }
      }

      const branchInfo = await gitlabRequest<GitlabBranch>({
        method: 'GET',
        path: gitlabEndpoints.branch(project, branch),
        idempotent: true,
      });
      const branchProblem = checkWritableBranch(branch, branchInfo.data ?? {});
      if (branchProblem) throw new GitlabApiError(branchProblem, 0, false);

      const payloadActions = actions.map((action) => ({
        action: action.action,
        file_path: action.file_path,
        content: action.content,
        last_commit_id: action.last_commit_id,
        previous_path: action.previous_path,
      }));
      const files = payloadActions.map((action) => action.file_path);

      if (input.dry_run) {
        return {
          dry_run: true,
          project,
          branch,
          message,
          files,
          note: '演练模式：只返回将要提交的文件，没有真的写入仓库',
        };
      }

      const result = await gitlabRequest<{
        id?: string;
        short_id?: string;
        title?: string;
        web_url?: string;
      }>({
        method: 'POST',
        path: gitlabEndpoints.commits(project),
        body: { branch, commit_message: message, actions: payloadActions },
      });

      return {
        project,
        branch,
        commit_sha: result.data?.id ?? null,
        short_sha: result.data?.short_id ?? null,
        title: result.data?.title ?? message,
        url: result.data?.web_url ?? null,
        files,
        note: '文件正文没有回传，需要看内容请用 gitlab_list_commits 或让用户直接看仓库',
      };
    });
  },
  {
    name: 'gitlab_commit_files',
    description:
      '把文件改动直接提交到 GitLab 仓库某个分支（不需要本地 git）。' +
      'actions 里 action 取 create/update/delete/move/chmod；改已存在的文件（update）建议带 last_commit_id 做并发保护。' +
      '受保护分支和默认分支会被护栏拦下。写操作，动手前先跟用户确认文件清单。',
    schema: strictObject({
      project: projectSchema.describe('项目路径，形如 组名/项目名'),
      branch: branchSchema.describe('要提交到哪个分支'),
      message: z.string().trim().min(1).max(5000).describe('提交说明，说清改了什么'),
      actions: z
        .array(
          strictObject({
            action: z
              .enum(['create', 'update', 'delete', 'move', 'chmod'])
              .describe('改动类型：新建/修改/删除/改名/改权限'),
            file_path: z.string().trim().min(1).max(4096).describe('目标文件路径（改名时是改名后的路径）'),
            content: z.string().optional().describe('文件正文，create/update 时必填'),
            last_commit_id: z
              .string()
              .optional()
              .describe('该文件最后一次读到的 commit SHA，用于并发保护'),
            previous_path: z.string().trim().min(1).max(4096).optional().describe('move 操作时的原路径'),
          })
        )
        .describe('本次要提交的文件改动列表'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要提交的文件，不真的写入，默认 false'),
    }),
  }
);
