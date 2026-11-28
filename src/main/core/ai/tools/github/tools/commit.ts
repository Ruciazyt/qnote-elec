import { tool } from "../../tool";
import { z } from 'zod';
import { GithubApiError, githubList, githubRequest } from '../api/client';
import { githubEndpoints } from '../api/endpoints';
import {
  clampLimit,
  listWithCursorUsing,
  requireRepository,
  requireWritable,
  runGithubTool,
} from '../utils/helpers';
import { checkWritableBranch } from '../utils/guards';
import type { GitHubBranch, GitHubCommit, GitHubRepository } from '../api/types';
import { branchSchema, paginationShape, repositorySchema, strictObject } from '../schemas/input';

export const githubListCommitsTool = tool(
  async (input: { repository: string; ref?: string; limit?: number; cursor?: string }) => {
    return runGithubTool('github_list_commits', input.repository, async () => {
      const repository = requireRepository(input.repository);
      const limit = clampLimit(input.limit, 20, 100);
      const page = await listWithCursorUsing<GitHubCommit>(
        {
          kind: 'commits:' + repository,
          path: githubEndpoints.commits(repository),
          query: { sha: input.ref?.trim() || undefined },
          cursor: input.cursor,
          perPage: limit,
        },
        githubList
      );
      const commits = page.items.map((item) => ({
        sha: item.sha?.slice(0, 8) ?? '',
        full_sha: item.sha ?? null,
        title: (item.commit?.message ?? '').split('\n')[0] ?? '',
        author: item.commit?.author?.name ?? null,
        created_at: item.commit?.author?.date ?? null,
        url: item.html_url ?? null,
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
    name: 'github_list_commits',
    description:
      '列出某个仓库或分支上的提交，返回 SHA、标题、作者、时间。' +
      '要确认某个分支当前的 HEAD，用 github_list_branches 里的 head_sha 更直接。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      ref: branchSchema.optional().describe('只看某个分支的提交，可选'),
      ...paginationShape,
    }),
  }
);

export const githubCommitFilesTool = tool(
  async (input: {
    repository: string;
    branch: string;
    message: string;
    actions: Array<{
      action: 'create' | 'update' | 'delete' | 'move';
      file_path: string;
      content?: string;
      previous_path?: string;
    }>;
    base_sha?: string;
    dry_run?: boolean;
  }) => {
    return runGithubTool('github_commit_files', input.repository, async () => {
      const repository = requireRepository(input.repository);
      requireWritable();
      const branch = (input.branch ?? '').trim();
      if (!branch) throw new GithubApiError('缺少目标分支', 0, false);
      const message = (input.message ?? '').trim();
      if (!message) throw new GithubApiError('缺少提交说明', 0, false);
      const actions = (input.actions ?? []).filter(Boolean);
      if (!actions.length) throw new GithubApiError('至少要有一个文件改动', 0, false);
      for (const action of actions) {
        if (!action.file_path) throw new GithubApiError('文件改动缺少 file_path', 0, false);
        if (action.action === 'move' && !action.previous_path) {
          throw new GithubApiError('move 操作必须给 previous_path', 0, false);
        }
        if (action.action !== 'delete' && action.content === undefined) {
          throw new GithubApiError(action.action + ' 操作必须给 content', 0, false);
        }
      }

      const branchInfo = await githubRequest<GitHubBranch>({
        method: 'GET',
        path: githubEndpoints.branch(repository, branch),
        idempotent: true,
      });
      const repoInfo = await githubRequest<GitHubRepository>({
        method: 'GET',
        path: githubEndpoints.repository(repository),
        idempotent: true,
      });
      const branchProblem = checkWritableBranch(branch, {
        protected: branchInfo.data?.protected === true,
        default: repoInfo.data?.default_branch === branch,
      });
      if (branchProblem) throw new GithubApiError(branchProblem, 0, false);

      const files = actions.map((action) => action.file_path);
      if (input.dry_run) {
        return {
          dry_run: true,
          repository,
          branch,
          message,
          files,
          note: '演练模式：只返回将要提交的文件，没有真的写入仓库',
        };
      }

      const base = await githubRequest<{ sha?: string; tree?: { sha?: string } }>({
        method: 'GET',
        path: githubEndpoints.gitCommit(repository, branch),
        idempotent: true,
      });
      const baseSha = base.data?.sha;
      const baseTree = base.data?.tree?.sha;
      if (!baseSha || !baseTree) {
        throw new GithubApiError('分支「' + branch + '」解析不到 HEAD 提交信息', 0, false);
      }
      const expected = (input.base_sha ?? '').trim();
      if (expected && expected !== baseSha) {
        throw new GithubApiError(
          '分支「' + branch + '」的 HEAD 已经变了（当前 ' + baseSha.slice(0, 8) + '，你给的是 ' + expected.slice(0, 8) + '），先重新读一次再决定',
          0,
          false
        );
      }

      const entries: Array<{ path: string; mode: string; type: 'blob'; sha: string | null }> = [];
      for (const action of actions) {
        if (action.action === 'delete') {
          entries.push({ path: action.file_path, mode: '100644', type: 'blob', sha: null });
          continue;
        }
        const blob = await githubRequest<{ sha?: string }>({
          method: 'POST',
          path: githubEndpoints.gitBlobs(repository),
          body: { content: action.content, encoding: 'utf-8' },
        });
        if (!blob.data?.sha) {
          throw new GithubApiError('写入 blob 失败：' + action.file_path, 0, false);
        }
        if (action.action === 'move' && action.previous_path) {
          entries.push({ path: action.previous_path, mode: '100644', type: 'blob', sha: null });
        }
        entries.push({ path: action.file_path, mode: '100644', type: 'blob', sha: blob.data.sha });
      }

      const tree = await githubRequest<{ sha?: string }>({
        method: 'POST',
        path: githubEndpoints.gitTrees(repository),
        body: { base_tree: baseTree, tree: entries },
      });
      if (!tree.data?.sha) throw new GithubApiError('写入 tree 失败', 0, false);

      const commit = await githubRequest<{ sha?: string; html_url?: string }>({
        method: 'POST',
        path: githubEndpoints.gitCommits(repository),
        body: { message, tree: tree.data.sha, parents: [baseSha] },
      });
      if (!commit.data?.sha) throw new GithubApiError('创建 commit 失败', 0, false);

      await githubRequest({
        method: 'PATCH',
        path: githubEndpoints.gitRef(repository, branch),
        body: { sha: commit.data.sha, force: false },
      });

      return {
        repository,
        branch,
        commit_sha: commit.data.sha,
        short_sha: commit.data.sha.slice(0, 8),
        title: message,
        url: commit.data.html_url ?? null,
        files,
        note: '文件正文没有回传，需要看内容请用 github_list_commits 或让用户直接看仓库',
      };
    });
  },
  {
    name: 'github_commit_files',
    description:
      '把文件改动直接提交到 GitHub 仓库某个分支（不需要本地 git）。' +
      'actions 里 action 取 create/update/delete/move；GitHub 没有文件级乐观锁，这里用 base_sha 锁分支 HEAD。' +
      '受保护分支和默认分支会被护栏拦下。写操作，动手前先跟用户确认文件清单。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      branch: branchSchema.describe('要提交到哪个分支'),
      message: z.string().trim().min(1).max(5000).describe('提交说明，说清改了什么'),
      actions: z
        .array(
          strictObject({
            action: z
              .enum(['create', 'update', 'delete', 'move'])
              .describe('改动类型：新建/修改/删除/改名'),
            file_path: z.string().trim().min(1).max(4096).describe('目标文件路径（改名时是改名后的路径）'),
            content: z.string().optional().describe('文件正文，create/update/move 时必填'),
            previous_path: z.string().trim().min(1).max(4096).optional().describe('move 操作时的原路径'),
          })
        )
        .describe('本次要提交的文件改动列表'),
      base_sha: z
        .string()
        .optional()
        .describe('目标分支当前 HEAD 的 SHA，用于并发保护；不填就不校验'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要提交的文件，不真的写入，默认 false'),
    }),
  }
);
