import { tool } from "../../tool";
import { z } from 'zod';
import { GithubApiError, githubList, githubRequest, parseLinkHeader } from '../api/client';
import { githubEndpoints } from '../api/endpoints';
import { getGithubConfig } from '../runtime/config';
import {
  capText,
  clampLimit,
  listWithCursorUsing,
  requireRepository,
  requireWritable,
  runGithubTool,
} from '../utils/helpers';
import { checkCommentBody } from '../utils/guards';
import { redactSecrets } from '../utils/shape';
import type { GitHubComment, GitHubIssue } from '../api/types';
import {
  cursorSchema,
  issueNumberSchema,
  paginationShape,
  repositorySchema,
  searchSchema,
  stateSchema,
  strictObject,
} from '../schemas/input';

async function listIssuePage(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  page: number,
  perPage: number
): Promise<{ items: GitHubIssue[]; nextPage: number | null; total: number | null }> {
  if (path === '/search/issues') {
    const result = await githubRequest<{ total_count?: number; items?: GitHubIssue[] }>({
      method: 'GET',
      path,
      query: { ...query, page, per_page: perPage },
      idempotent: true,
    });
    const link = parseLinkHeader(result.headers['link']);
    return {
      items: (result.data.items ?? []).filter((item) => !item.pull_request),
      nextPage: link.nextPage,
      total: result.data.total_count ?? null,
    };
  }
  const result = await githubList<GitHubIssue>(path, query, page, perPage);
  return {
    ...result,
    items: result.items.filter((item) => !item.pull_request),
  };
}

export const githubListIssuesTool = tool(
  async (input: {
    repository: string;
    state?: 'open' | 'closed' | 'all';
    search?: string;
    labels?: string[];
    assignee?: string;
    limit?: number;
    cursor?: string;
  }) => {
    return runGithubTool('github_list_issues', input.repository, async () => {
      const repository = requireRepository(input.repository);
      const limit = clampLimit(input.limit, 20, 100);
      const keyword = input.search?.trim();
      const state = input.state ?? 'open';
      const labels = input.labels ?? [];
      const assignee = input.assignee?.trim();
      const page = await listWithCursorUsing<GitHubIssue>(
        {
          kind: 'issues:' + repository,
          path: keyword ? '/search/issues' : githubEndpoints.issues(repository),
          query: keyword
            ? {
                q: [
                  'repo:' + repository,
                  'is:issue',
                  state === 'all' ? '' : 'is:' + state,
                  ...labels.map((label) => 'label:"' + label + '"'),
                  assignee ? 'assignee:' + assignee : '',
                  keyword,
                ]
                  .filter(Boolean)
                  .join(' '),
              }
            : {
                state,
                labels: labels.length ? labels.join(',') : undefined,
                assignee,
                sort: 'updated',
                direction: 'desc',
              },
          cursor: input.cursor,
          perPage: limit,
        },
        listIssuePage
      );
      const issues = page.items.map((item) => ({
        number: item.number,
        title: item.title,
        state: item.state,
        labels: (item.labels ?? []).map((label) => label.name ?? '').filter(Boolean),
        assignees: (item.assignees ?? []).map((user) => user.login ?? '').filter(Boolean),
        updated_at: item.updated_at ?? null,
        url: item.html_url ?? null,
      }));
      return {
        count: issues.length,
        total: page.total,
        issues,
        next_cursor: page.nextCursor,
        next_hint: page.nextCursor
          ? '还有更多 Issue，把 next_cursor 原样传回本工具即可继续取下一页'
          : null,
      };
    });
  },
  {
    name: 'github_list_issues',
    description:
      '列出仓库里的 Issue，返回编号、标题、状态、标签、更新时间（不返回正文，省上下文）。' +
      'Pull Request 不在结果里。拿到 number 后再用 github_get_issue 读详情和评论。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      state: z.enum(['open', 'closed', 'all']).optional().describe('状态过滤，默认 open'),
      search: searchSchema.optional().describe('按标题/正文搜索，可选，会走 GitHub 搜索接口'),
      labels: z.array(z.string()).optional().describe('标签过滤，全部命中才算匹配'),
      assignee: z.string().optional().describe('负责人 login，可选'),
      ...paginationShape,
    }),
  }
);

export const githubGetIssueTool = tool(
  async (input: { repository: string; number: number; comment_limit?: number; comment_cursor?: string }) => {
    return runGithubTool('github_get_issue', input.repository, async () => {
      const repository = requireRepository(input.repository);
      const number = Number(input.number);
      if (!Number.isFinite(number)) {
        throw new GithubApiError('缺少 Issue 的编号（先用 github_list_issues 拿到）', 0, false);
      }
      const issue = await githubRequest<GitHubIssue>({
        method: 'GET',
        path: githubEndpoints.issue(repository, number),
        idempotent: true,
      });
      const commentLimit = clampLimit(input.comment_limit, 5, 50);
      const comments = await listWithCursorUsing<GitHubComment>(
        {
          kind: 'comments:' + repository + ':' + number,
          path: githubEndpoints.issueComments(repository, number),
          query: {},
          cursor: input.comment_cursor,
          perPage: commentLimit,
        },
        githubList
      );

      const cfg = getGithubConfig();
      const body = redactSecrets(issue.data?.body ?? '');
      const capped = await capText(body, 'issue-' + number, cfg.maxResultTokens);

      return {
        number: issue.data?.number ?? number,
        title: issue.data?.title ?? null,
        state: issue.data?.state ?? null,
        labels: (issue.data?.labels ?? []).map((label) => label.name ?? '').filter(Boolean),
        assignees: (issue.data?.assignees ?? []).map((user) => user.login ?? '').filter(Boolean),
        author: issue.data?.user?.login ?? null,
        created_at: issue.data?.created_at ?? null,
        updated_at: issue.data?.updated_at ?? null,
        url: issue.data?.html_url ?? null,
        description: capped.text,
        description_truncated: capped.truncated,
        description_full_path: capped.fullPath,
        comment_count: comments.items.length,
        comments: comments.items.map((comment) => ({
          id: comment.id,
          author: comment.user?.login ?? null,
          created_at: comment.created_at ?? null,
          body: redactSecrets(comment.body ?? ''),
        })),
        comment_cursor: comments.nextCursor,
        comment_hint: comments.nextCursor
          ? '评论还有更多，把 comment_cursor 原样传回本工具即可继续读'
          : null,
      };
    });
  },
  {
    name: 'github_get_issue',
    description:
      '读一个 Issue 的详情：标题、描述、状态、标签、负责人，以及最近几条评论。' +
      'number 必须来自 github_list_issues，不能猜。描述过长时只回开头，完整正文在 description_full_path 里。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      number: issueNumberSchema.describe('Issue 的编号，来自 github_list_issues'),
      comment_limit: z.number().int().min(1).max(50).optional().describe('本次最多取几条评论，默认 5，最多 50'),
      comment_cursor: cursorSchema.optional().describe('上一页返回的 comment_cursor，原样传回即可继续读评论'),
    }),
  }
);

export const githubCreateIssueTool = tool(
  async (input: {
    repository: string;
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
    dry_run?: boolean;
  }) => {
    return runGithubTool('github_create_issue', input.repository, async () => {
      const repository = requireRepository(input.repository);
      requireWritable();
      const title = (input.title ?? '').trim();
      if (!title) throw new GithubApiError('Issue 标题不能为空', 0, false);
      if (input.dry_run) {
        return {
          dry_run: true,
          repository,
          title,
          message: '演练模式：只返回将要创建的 Issue，没有真的创建',
        };
      }
      const result = await githubRequest<GitHubIssue>({
        method: 'POST',
        path: githubEndpoints.issues(repository),
        body: {
          title,
          body: input.body,
          labels: input.labels?.length ? input.labels : undefined,
          assignees: input.assignees?.length ? input.assignees : undefined,
        },
      });
      return {
        repository,
        number: result.data?.number ?? null,
        title: result.data?.title ?? title,
        state: result.data?.state ?? null,
        url: result.data?.html_url ?? null,
      };
    });
  },
  {
    name: 'github_create_issue',
    description:
      '在仓库里新建一个 Issue。写操作，创建前先跟用户确认标题和内容。' +
      '返回新 Issue 的编号和链接。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      title: z.string().trim().min(1).max(500).describe('Issue 标题'),
      body: z.string().optional().describe('Issue 正文，可选'),
      labels: z.array(z.string()).optional().describe('标签，可选'),
      assignees: z.array(z.string()).optional().describe('负责人 login 列表，可选'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要创建的 Issue，不真的创建，默认 false'),
    }),
  }
);

export const githubUpdateIssueTool = tool(
  async (input: {
    repository: string;
    number: number;
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    labels?: string[];
    assignees?: string[];
    dry_run?: boolean;
  }) => {
    return runGithubTool('github_update_issue', input.repository, async () => {
      const repository = requireRepository(input.repository);
      requireWritable();
      const number = Number(input.number);
      if (!Number.isFinite(number)) {
        throw new GithubApiError('缺少 Issue 的编号（先用 github_list_issues 拿到）', 0, false);
      }
      const body: Record<string, unknown> = {};
      if (input.title !== undefined) body.title = input.title.trim();
      if (input.body !== undefined) body.body = input.body;
      if (input.state !== undefined) body.state = input.state;
      if (input.labels !== undefined) body.labels = input.labels;
      if (input.assignees !== undefined) body.assignees = input.assignees;
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
      const result = await githubRequest<GitHubIssue>({
        method: 'PATCH',
        path: githubEndpoints.issue(repository, number),
        body,
      });
      if (input.state !== undefined && result.data?.state !== input.state) {
        throw new GithubApiError(
          `Issue 状态更新未生效：期望 ${input.state}，实际 ${result.data?.state ?? '未知'}`,
          result.data ? 200 : 0,
          false
        );
      }
      return {
        repository,
        number: result.data?.number ?? number,
        title: result.data?.title ?? null,
        state: result.data?.state ?? null,
        labels: (result.data?.labels ?? []).map((label) => label.name ?? '').filter(Boolean),
        updated_at: result.data?.updated_at ?? null,
        url: result.data?.html_url ?? null,
        changes: body,
      };
    });
  },
  {
    name: 'github_update_issue',
    description:
      '改 Issue 的标题、正文、状态、标签或负责人。写操作，改之前先读当前状态、跟用户确认。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      number: issueNumberSchema.describe('Issue 的编号，来自 github_list_issues'),
      title: z.string().trim().min(1).max(500).optional().describe('新标题'),
      body: z.string().optional().describe('新正文'),
      state: stateSchema.optional().describe('目标状态'),
      labels: z.array(z.string()).optional().describe('新标签列表，会覆盖原有标签'),
      assignees: z.array(z.string()).optional().describe('新负责人 login 列表'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要修改的字段，不真的改动，默认 false'),
    }),
  }
);

export const githubAddCommentTool = tool(
  async (input: { repository: string; number: number; body: string; dry_run?: boolean }) => {
    return runGithubTool('github_add_comment', input.repository, async () => {
      const repository = requireRepository(input.repository);
      requireWritable();
      const number = Number(input.number);
      if (!Number.isFinite(number)) {
        throw new GithubApiError('缺少 Issue 或 Pull Request 的编号', 0, false);
      }
      const bodyProblem = checkCommentBody(input.body ?? '');
      if (bodyProblem) throw new GithubApiError(bodyProblem, 0, false);
      if (input.dry_run) {
        return {
          dry_run: true,
          repository,
          number,
          message: '演练模式：只返回将要追加的评论，没有真的发送',
        };
      }
      const target = await githubRequest<GitHubIssue>({
        method: 'GET',
        path: githubEndpoints.issue(repository, number),
        idempotent: true,
      });
      const comment = await githubRequest<GitHubComment>({
        method: 'POST',
        path: githubEndpoints.issueComments(repository, number),
        body: { body: input.body },
      });
      const url = target.data?.html_url ?? null;
      return {
        repository,
        number,
        comment_id: comment.data?.id ?? null,
        created_at: comment.data?.created_at ?? null,
        url: url ? url + '#issuecomment-' + comment.data?.id : null,
      };
    });
  },
  {
    name: 'github_add_comment',
    description:
      '给 Issue 或 Pull Request 追加一条评论（只能追加，不能改别人的评论或删评论）。' +
      '写操作，发送前先给用户看一遍要发的内容。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      number: issueNumberSchema.describe('Issue 或 Pull Request 的编号'),
      body: z.string().trim().min(1).max(100000).describe('评论正文'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要发送的评论，不真的发送，默认 false'),
    }),
  }
);
