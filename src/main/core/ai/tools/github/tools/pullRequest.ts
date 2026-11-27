import { tool } from "../../tool";
import { z } from 'zod';
import { GithubApiError, githubRequest } from '../api/client';
import { githubEndpoints } from '../api/endpoints';
import {
  clampLimit,
  listWithCursorUsing,
  requireRepository,
  requireWritable,
  runGithubTool,
} from '../utils/helpers';
import type { GitHubPullRequest } from '../api/types';
import {
  branchSchema,
  issueNumberSchema,
  paginationShape,
  repositorySchema,
  stateSchema,
  strictObject,
} from '../schemas/input';

export const githubListPullRequestsTool = tool(
  async (input: {
    repository: string;
    state?: 'open' | 'closed' | 'all';
    base?: string;
    head?: string;
    limit?: number;
    cursor?: string;
  }) => {
    return runGithubTool('github_list_pull_requests', input.repository, async () => {
      const repository = requireRepository(input.repository);
      const limit = clampLimit(input.limit, 20, 100);
      const page = await listWithCursorUsing<GitHubPullRequest>(
        {
          kind: 'pulls:' + repository,
          path: githubEndpoints.pullRequests(repository),
          query: {
            state: input.state ?? 'open',
            base: input.base?.trim() || undefined,
            head: input.head?.trim() || undefined,
            sort: 'updated',
            direction: 'desc',
          },
          cursor: input.cursor,
          perPage: limit,
        },
        async (path, query, pageNumber, perPage) => {
          const result = await githubRequest<GitHubPullRequest[]>({
            method: 'GET',
            path,
            query: { ...query, page: pageNumber, per_page: perPage },
            idempotent: true,
          });
          return { items: result.data ?? [], nextPage: null, total: null };
        }
      );
      const pullRequests = page.items.map((item) => ({
        number: item.number,
        title: item.title,
        state: item.state,
        draft: item.draft === true,
        source_branch: item.head?.ref ?? null,
        target_branch: item.base?.ref ?? null,
        head_sha: item.head?.sha ?? null,
        mergeable_state: item.mergeable_state ?? null,
        updated_at: item.updated_at ?? null,
        url: item.html_url ?? null,
      }));
      return {
        count: pullRequests.length,
        total: page.total,
        pull_requests: pullRequests,
        next_cursor: page.nextCursor,
        next_hint: page.nextCursor
          ? '还有更多 PR，把 next_cursor 原样传回本工具即可继续取下一页'
          : null,
      };
    });
  },
  {
    name: 'github_list_pull_requests',
    description:
      '列出仓库里的 Pull Request，返回编号、标题、状态、源/目标分支、是否可合并。' +
      '要合并或改 PR，先用 github_list_pull_requests 拿到编号和当前状态。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      state: z.enum(['open', 'closed', 'all']).optional().describe('状态过滤，默认 open'),
      base: branchSchema.optional().describe('只看合入某个目标分支的 PR，可选'),
      head: branchSchema.optional().describe('只看来自某个源分支的 PR，可选'),
      ...paginationShape,
    }),
  }
);

export const githubCreatePullRequestTool = tool(
  async (input: {
    repository: string;
    source_branch: string;
    target_branch: string;
    title: string;
    body?: string;
    draft?: boolean;
    dry_run?: boolean;
  }) => {
    return runGithubTool('github_create_pull_request', input.repository, async () => {
      const repository = requireRepository(input.repository);
      requireWritable();
      const source = (input.source_branch ?? '').trim();
      const target = (input.target_branch ?? '').trim();
      const title = (input.title ?? '').trim();
      if (!source) throw new GithubApiError('缺少源分支 source_branch', 0, false);
      if (!target) throw new GithubApiError('缺少目标分支 target_branch', 0, false);
      if (!title) throw new GithubApiError('缺少 PR 标题', 0, false);
      if (source === target) throw new GithubApiError('源分支和目标分支不能相同', 0, false);
      if (input.dry_run) {
        return {
          dry_run: true,
          repository,
          source_branch: source,
          target_branch: target,
          title,
          message: '演练模式：只返回将要创建的 PR，没有真的创建',
        };
      }
      const result = await githubRequest<GitHubPullRequest>({
        method: 'POST',
        path: githubEndpoints.pullRequests(repository),
        body: {
          head: source,
          base: target,
          title,
          body: input.body,
          draft: input.draft,
        },
      });
      return {
        repository,
        number: result.data?.number ?? null,
        title: result.data?.title ?? title,
        state: result.data?.state ?? null,
        draft: result.data?.draft === true,
        url: result.data?.html_url ?? null,
      };
    });
  },
  {
    name: 'github_create_pull_request',
    description:
      '为某个 feature/fix 分支创建 Pull Request。写操作，创建前先跟用户确认源分支、目标分支和标题。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      source_branch: branchSchema.describe('源分支（改动所在分支）'),
      target_branch: branchSchema.describe('目标分支（通常是 main/master/develop）'),
      title: z.string().trim().min(1).max(500).describe('PR 标题'),
      body: z.string().optional().describe('PR 描述，可选'),
      draft: z.boolean().optional().describe('是否建成草稿 PR'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要创建的 PR，不真的创建，默认 false'),
    }),
  }
);

export const githubUpdatePullRequestTool = tool(
  async (input: {
    repository: string;
    number: number;
    title?: string;
    body?: string;
    target_branch?: string;
    state?: 'open' | 'closed';
    dry_run?: boolean;
  }) => {
    return runGithubTool('github_update_pull_request', input.repository, async () => {
      const repository = requireRepository(input.repository);
      requireWritable();
      const number = Number(input.number);
      if (!Number.isFinite(number)) {
        throw new GithubApiError('缺少 PR 的编号（先用 github_list_pull_requests 拿到）', 0, false);
      }
      const body: Record<string, unknown> = {};
      if (input.title !== undefined) body.title = input.title.trim();
      if (input.body !== undefined) body.body = input.body;
      if (input.target_branch !== undefined) body.base = input.target_branch.trim();
      if (input.state !== undefined) body.state = input.state;
      if (!Object.keys(body).length) {
        throw new GithubApiError('没有要改的字段', 0, false);
      }
      if (input.dry_run) {
        return {
          dry_run: true,
          repository,
          number,
          changes: body,
          message: '演练模式：只返回将要修改的字段，没有真的改动',
        };
      }
      const result = await githubRequest<GitHubPullRequest>({
        method: 'PATCH',
        path: githubEndpoints.pullRequest(repository, number),
        body,
      });
      if (input.state !== undefined && result.data?.state !== input.state) {
        throw new GithubApiError(
          `Pull Request 状态更新未生效：期望 ${input.state}，实际 ${result.data?.state ?? '未知'}`,
          result.data ? 200 : 0,
          false
        );
      }
      return {
        repository,
        number: result.data?.number ?? number,
        title: result.data?.title ?? null,
        state: result.data?.state ?? null,
        source_branch: result.data?.head?.ref ?? null,
        target_branch: result.data?.base?.ref ?? null,
        updated_at: result.data?.updated_at ?? null,
        url: result.data?.html_url ?? null,
        changes: body,
      };
    });
  },
  {
    name: 'github_update_pull_request',
    description:
      '改 Pull Request 的标题、描述、目标分支或状态。写操作，改之前先读当前状态、跟用户确认。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      number: issueNumberSchema.describe('PR 的编号，来自 github_list_pull_requests'),
      title: z.string().trim().min(1).max(500).optional().describe('新标题'),
      body: z.string().optional().describe('新描述'),
      target_branch: branchSchema.optional().describe('新目标分支'),
      state: stateSchema.optional().describe('目标状态'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要修改的字段，不真的改动，默认 false'),
    }),
  }
);

export const githubMergePullRequestTool = tool(
  async (input: {
    repository: string;
    number: number;
    sha?: string;
    merge_method?: 'merge' | 'squash' | 'rebase';
    dry_run?: boolean;
  }) => {
    return runGithubTool('github_merge_pull_request', input.repository, async () => {
      const repository = requireRepository(input.repository);
      requireWritable();
      const number = Number(input.number);
      if (!Number.isFinite(number)) {
        throw new GithubApiError('缺少 PR 的编号（先用 github_list_pull_requests 拿到）', 0, false);
      }
      const current = await githubRequest<GitHubPullRequest>({
        method: 'GET',
        path: githubEndpoints.pullRequest(repository, number),
        idempotent: true,
      });
      const mergeState = current.data?.mergeable_state ?? null;
      if (current.data?.state && current.data.state !== 'open') {
        throw new GithubApiError(
          'PR 当前状态是 ' + current.data.state + '，不能再合并',
          0,
          false
        );
      }
      if (mergeState === 'dirty') {
        throw new GithubApiError('PR 现在有冲突（mergeable_state=dirty），先解决冲突', 0, false);
      }
      if (mergeState === 'blocked') {
        throw new GithubApiError(
          'PR 被分支保护或审批要求挡住（mergeable_state=blocked），先满足这些要求',
          0,
          false
        );
      }
      if (input.dry_run) {
        return {
          dry_run: true,
          repository,
          number,
          mergeable_state: mergeState,
          message: '演练模式：只返回将要执行的合并，没有真的合并',
        };
      }
      const result = await githubRequest<{ merged?: boolean; sha?: string; message?: string }>({
        method: 'PUT',
        path: githubEndpoints.mergePullRequest(repository, number),
        body: {
          sha: input.sha,
          merge_method: input.merge_method,
        },
      });
      return {
        repository,
        number,
        merged: result.data?.merged === true,
        merge_commit_sha: result.data?.sha ?? null,
        message: result.data?.message ?? null,
        url: current.data?.html_url ?? null,
      };
    });
  },
  {
    name: 'github_merge_pull_request',
    description:
      '合并一个 Pull Request。合并前会先检查 PR 状态与可合并性，不通过会直接告诉你原因。' +
      '这是会改变仓库的操作，必须先跟用户明确确认再执行。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      number: issueNumberSchema.describe('PR 的编号，来自 github_list_pull_requests'),
      sha: z.string().optional().describe('期望合并的 head SHA，防止合错版本'),
      merge_method: z.enum(['merge', 'squash', 'rebase']).optional().describe('合并方式，默认仓库设置'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只检查可合并性，不真的合并，默认 false'),
    }),
  }
);
