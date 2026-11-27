import { tool } from "../../tool";
import { z } from 'zod';
import { GithubApiError, githubList, githubRequest, parseLinkHeader } from '../api/client';
import { githubEndpoints } from '../api/endpoints';
import {
  clampLimit,
  listWithCursorUsing,
  requireRepository,
  requireWritable,
  runGithubTool,
} from '../utils/helpers';
import { checkBranchName } from '../utils/guards';
import type { GitHubBranch, GitHubRepository } from '../api/types';
import {
  branchSchema,
  paginationShape,
  repositorySchema,
  searchSchema,
  strictObject,
} from '../schemas/input';

async function listRepositoryPage(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  page: number,
  perPage: number
): Promise<{ items: GitHubRepository[]; nextPage: number | null; total: number | null }> {
  if (path === '/search/repositories') {
    const result = await githubRequest<{ total_count?: number; items?: GitHubRepository[] }>({
      method: 'GET',
      path,
      query: { ...query, page, per_page: perPage },
      idempotent: true,
    });
    const link = parseLinkHeader(result.headers['link']);
    return {
      items: result.data.items ?? [],
      nextPage: link.nextPage,
      total: result.data.total_count ?? null,
    };
  }
  return githubList<GitHubRepository>(path, query, page, perPage);
}

export const githubListRepositoriesTool = tool(
  async (input: { search?: string; limit?: number; cursor?: string }) => {
    return runGithubTool('github_list_repositories', undefined, async () => {
      const limit = clampLimit(input.limit, 20, 100);
      const keyword = input.search?.trim();
      const page = await listWithCursorUsing<GitHubRepository>(
        {
          kind: 'repositories',
          path: keyword ? '/search/repositories' : githubEndpoints.repositories(),
          query: keyword
            ? { q: keyword }
            : { sort: 'updated', affiliation: 'owner,collaborator,organization' },
          cursor: input.cursor,
          perPage: limit,
        },
        listRepositoryPage
      );
      const repositories = page.items.map((item) => ({
        repository: item.full_name,
        default_branch: item.default_branch ?? null,
        private: item.private === true,
        updated_at: item.updated_at ?? null,
        url: item.html_url ?? null,
      }));
      return {
        count: repositories.length,
        total: page.total,
        repositories,
        next_cursor: page.nextCursor,
        next_hint: page.nextCursor
          ? '还有更多结果，把 next_cursor 原样传回本工具即可继续取下一页'
          : null,
      };
    });
  },
  {
    name: 'github_list_repositories',
    description:
      '列出当前 token 可见的 GitHub 仓库，返回仓库全名、默认分支、最后更新时间。' +
      '后面所有 GitHub 工具的 repository 参数都要用这里或分支列表里出现的 owner/repo，不要自己编。',
    schema: strictObject({
      search: searchSchema.optional().describe('按仓库名搜索，可选'),
      ...paginationShape,
    }),
  }
);

export const githubListBranchesTool = tool(
  async (input: { repository: string; search?: string; limit?: number; cursor?: string }) => {
    return runGithubTool('github_list_branches', input.repository, async () => {
      const repository = requireRepository(input.repository);
      const limit = clampLimit(input.limit, 20, 100);
      const page = await listWithCursorUsing<GitHubBranch>(
        {
          kind: 'branches:' + repository,
          path: githubEndpoints.branches(repository),
          query: {},
          cursor: input.cursor,
          perPage: limit,
        },
        githubList
      );
      const repoInfo = await githubRequest<GitHubRepository>({
        method: 'GET',
        path: githubEndpoints.repository(repository),
        idempotent: true,
      });
      const defaultBranch = repoInfo.data?.default_branch ?? null;
      const keyword = input.search?.trim().toLowerCase();
      const branches = page.items
        .filter((item) => !keyword || item.name.toLowerCase().includes(keyword))
        .map((item) => ({
          name: item.name,
          protected: item.protected === true,
          default: item.name === defaultBranch,
          head_sha: item.commit?.sha ?? null,
        }));
      return {
        count: branches.length,
        total: page.total,
        default_branch: defaultBranch,
        branches,
        next_cursor: page.nextCursor,
        next_hint: page.nextCursor
          ? '还有更多分支，把 next_cursor 原样传回本工具即可继续取下一页'
          : null,
      };
    });
  },
  {
    name: 'github_list_branches',
    description:
      '列出某个仓库的分支，返回分支名、是否受保护、是否默认分支、头提交 SHA。' +
      '提交改动前先用它确认目标分支存在，且不是受保护分支或默认分支。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      search: searchSchema.optional().describe('按分支名过滤，可选'),
      ...paginationShape,
    }),
  }
);

export const githubCreateBranchTool = tool(
  async (input: { repository: string; branch: string; ref?: string; dry_run?: boolean }) => {
    return runGithubTool('github_create_branch', input.repository, async () => {
      const repository = requireRepository(input.repository);
      requireWritable();
      const branch = (input.branch ?? '').trim();
      const branchProblem = checkBranchName(branch);
      if (branchProblem) throw new GithubApiError(branchProblem, 0, false);
      let ref = (input.ref ?? '').trim();
      if (!ref) {
        const repoInfo = await githubRequest<GitHubRepository>({
          method: 'GET',
          path: githubEndpoints.repository(repository),
          idempotent: true,
        });
        ref = (repoInfo.data?.default_branch ?? '').trim();
        if (!ref) throw new GithubApiError('仓库没有默认分支，无法确定基准分支', 0, false);
      }
      if (input.dry_run) {
        return {
          dry_run: true,
          repository,
          branch,
          ref,
          message: '演练模式：只返回将要执行的动作，没有真的创建分支',
        };
      }
      const source = await githubRequest<{ sha?: string }>({
        method: 'GET',
        path: githubEndpoints.gitCommit(repository, ref),
        idempotent: true,
      });
      const sha = source.data?.sha;
      if (!sha) throw new GithubApiError('基准分支「' + ref + '」解析不到 commit SHA', 0, false);
      const result = await githubRequest<{ ref?: string; object?: { sha?: string } }>({
        method: 'POST',
        path: githubEndpoints.gitRefs(repository),
        body: { ref: 'refs/heads/' + branch, sha },
      });
      return {
        repository,
        branch,
        ref,
        head_sha: result.data?.object?.sha ?? sha,
      };
    });
  },
  {
    name: 'github_create_branch',
    description:
      '在仓库里创建新分支。分支名必须以 feature/ 或 fix/ 开头（护栏硬性要求），ref 填基准分支（省略则用默认分支）。' +
      '分支已存在会报冲突，先用 github_list_branches 确认。写操作，动手前先跟用户确认。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      branch: branchSchema.describe('新分支名，必须以 feature/ 或 fix/ 开头'),
      ref: branchSchema.optional().describe('基准分支，新分支从这个分支拉出来'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要执行的动作，不真的创建，默认 false'),
    }),
  }
);

export const githubDeleteBranchTool = tool(
  async (input: { repository: string; branch: string; dry_run?: boolean }) => {
    return runGithubTool('github_delete_branch', input.repository, async () => {
      const repository = requireRepository(input.repository);
      requireWritable();
      const branch = (input.branch ?? '').trim();
      if (!branch) throw new GithubApiError('缺少分支名', 0, false);
      const info = await githubRequest<GitHubBranch>({
        method: 'GET',
        path: githubEndpoints.branch(repository, branch),
        idempotent: true,
      });
      const repoInfo = await githubRequest<GitHubRepository>({
        method: 'GET',
        path: githubEndpoints.repository(repository),
        idempotent: true,
      });
      if (repoInfo.data?.default_branch === branch) {
        throw new GithubApiError('不能删除默认分支「' + branch + '」', 0, false);
      }
      if (info.data?.protected) {
        throw new GithubApiError('分支「' + branch + '」受保护，不能删除', 0, false);
      }
      if (input.dry_run) {
        return {
          dry_run: true,
          repository,
          branch,
          message: '演练模式：只返回将要执行的动作，没有真的删除分支',
        };
      }
      await githubRequest({
        method: 'DELETE',
        path: githubEndpoints.gitRef(repository, branch),
      });
      return { repository, branch, deleted: true };
    });
  },
  {
    name: 'github_delete_branch',
    description:
      '删除仓库里的分支。默认分支和受保护分支会被护栏拦下。' +
      '这是破坏性操作，删之前必须先跟用户确认，必要时先用 dry_run 演练。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      branch: branchSchema.describe('要删除的分支名'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要执行的动作，不真的删除，默认 false'),
    }),
  }
);
