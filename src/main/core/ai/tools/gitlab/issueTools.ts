import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { GitlabApiError, encodeProjectId, gitlabRequest } from './client';
import { getGitlabConfig } from './config';
import { capText, clampLimit, listWithCursor, requireProject, requireWritable, runGitlabTool } from './helpers';
import { checkCommentBody } from './guards';
import { redactSecrets } from './shape';
import type { GitlabIssue, GitlabNote } from './types';

export const gitlabListIssuesTool = tool(
  async (input: {
    project: string;
    state?: 'opened' | 'closed' | 'all';
    search?: string;
    labels?: string;
    limit?: number;
    cursor?: string;
  }) => {
    return runGitlabTool('gitlab_list_issues', input.project, async () => {
      const project = requireProject(input.project);
      const limit = clampLimit(input.limit, 20, 100);
      const page = await listWithCursor<GitlabIssue>({
        kind: 'issues',
        path: '/projects/' + encodeProjectId(project) + '/issues',
        query: {
          state: input.state ?? 'opened',
          search: input.search?.trim() || undefined,
          labels: input.labels?.trim() || undefined,
          order_by: 'updated_at',
          sort: 'desc',
        },
        cursor: input.cursor,
        perPage: limit,
      });
      const issues = page.items.map((item) => ({
        iid: item.iid,
        title: item.title,
        state: item.state,
        labels: item.labels ?? [],
        updated_at: item.updated_at ?? null,
        url: item.web_url ?? null,
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
    name: 'gitlab_list_issues',
    description:
      '列出项目里的 Issue，返回 iid、标题、状态、标签、更新时间（不返回正文，省上下文）。' +
      '拿到 iid 后再用 gitlab_get_issue 读详情和评论。',
    schema: z.object({
      project: z.string().describe('项目路径，形如 组名/项目名'),
      state: z.enum(['opened', 'closed', 'all']).optional().describe('状态过滤，默认 opened'),
      search: z.string().optional().describe('按标题/正文搜索，可选'),
      labels: z.string().optional().describe('按标签过滤，逗号分隔，可选'),
      limit: z.number().int().min(1).max(100).optional().describe('本次最多取几条，默认 20，最多 100'),
      cursor: z.string().optional().describe('上一页返回的 next_cursor，原样传回即可继续翻页'),
    }),
  }
);

export const gitlabGetIssueTool = tool(
  async (input: { project: string; iid: number; note_limit?: number; note_cursor?: string }) => {
    return runGitlabTool('gitlab_get_issue', input.project, async () => {
      const project = requireProject(input.project);
      const iid = Number(input.iid);
      if (!Number.isFinite(iid)) {
        throw new GitlabApiError('缺少 Issue 的 iid（先用 gitlab_list_issues 拿到）', 0, false);
      }
      const encoded = encodeProjectId(project);
      const issue = await gitlabRequest<GitlabIssue>({
        method: 'GET',
        path: '/projects/' + encoded + '/issues/' + iid,
        idempotent: true,
      });
      const noteLimit = clampLimit(input.note_limit, 5, 50);
      const notes = await listWithCursor<GitlabNote>({
        kind: 'notes:' + project + ':' + iid,
        path: '/projects/' + encoded + '/issues/' + iid + '/notes',
        query: { sort: 'asc', order_by: 'created_at' },
        cursor: input.note_cursor,
        perPage: noteLimit,
      });

      const cfg = getGitlabConfig();
      const description = redactSecrets(issue.data?.description ?? '');
      const capped = await capText(description, 'issue-' + iid, cfg.maxResultTokens);

      const comments = notes.items
        .filter((note) => note.system !== true)
        .map((note) => ({
          id: note.id,
          author: note.author?.username ?? note.author?.name ?? null,
          created_at: note.created_at ?? null,
          body: redactSecrets(note.body ?? ''),
        }));

      return {
        iid: issue.data?.iid ?? iid,
        title: issue.data?.title ?? null,
        state: issue.data?.state ?? null,
        labels: issue.data?.labels ?? [],
        assignees: (issue.data?.assignees ?? []).map((user) => user.username ?? user.name ?? null),
        author: issue.data?.author?.username ?? null,
        created_at: issue.data?.created_at ?? null,
        updated_at: issue.data?.updated_at ?? null,
        url: issue.data?.web_url ?? null,
        description: capped.text,
        description_truncated: capped.truncated,
        description_full_path: capped.fullPath,
        comment_count: comments.length,
        comments,
        note_cursor: notes.nextCursor,
        note_hint: notes.nextCursor
          ? '评论还有更多，把 note_cursor 原样传回本工具即可继续读'
          : null,
      };
    });
  },
  {
    name: 'gitlab_get_issue',
    description:
      '读一个 Issue 的详情：标题、描述、状态、标签、负责人，以及最近几条评论。' +
      'iid 必须来自 gitlab_list_issues，不能猜。描述过长时只回开头，完整正文在 description_full_path 里。',
    schema: z.object({
      project: z.string().describe('项目路径，形如 组名/项目名'),
      iid: z.number().int().describe('Issue 的 iid，来自 gitlab_list_issues'),
      note_limit: z.number().int().min(1).max(50).optional().describe('本次最多取几条评论，默认 5，最多 50'),
      note_cursor: z.string().optional().describe('上一页返回的 note_cursor，原样传回即可继续读评论'),
    }),
  }
);

export const gitlabCreateIssueTool = tool(
  async (input: {
    project: string;
    title: string;
    description?: string;
    labels?: string;
    assignee_id?: number;
    dry_run?: boolean;
  }) => {
    return runGitlabTool('gitlab_create_issue', input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();
      const title = (input.title ?? '').trim();
      if (!title) throw new GitlabApiError('Issue 标题不能为空', 0, false);
      if (input.dry_run) {
        return {
          dry_run: true,
          project,
          title,
          message: '演练模式：只返回将要创建的 Issue，没有真的创建',
        };
      }
      const result = await gitlabRequest<GitlabIssue>({
        method: 'POST',
        path: '/projects/' + encodeProjectId(project) + '/issues',
        body: {
          title,
          description: input.description,
          labels: input.labels?.trim() || undefined,
          assignee_id: input.assignee_id,
        },
      });
      return {
        project,
        iid: result.data?.iid ?? null,
        title: result.data?.title ?? title,
        state: result.data?.state ?? null,
        url: result.data?.web_url ?? null,
      };
    });
  },
  {
    name: 'gitlab_create_issue',
    description:
      '在项目里新建一个 Issue。写操作，创建前先跟用户确认标题和内容。' +
      '返回新 Issue 的 iid 和链接。',
    schema: z.object({
      project: z.string().describe('项目路径，形如 组名/项目名'),
      title: z.string().describe('Issue 标题'),
      description: z.string().optional().describe('Issue 正文，可选'),
      labels: z.string().optional().describe('标签，逗号分隔，可选'),
      assignee_id: z.number().int().optional().describe('负责人用户 ID，可选'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要创建的 Issue，不真的创建，默认 false'),
    }),
  }
);

export const gitlabUpdateIssueTool = tool(
  async (input: {
    project: string;
    iid: number;
    title?: string;
    description?: string;
    state?: 'opened' | 'closed';
    labels?: string;
    assignee_id?: number;
    dry_run?: boolean;
  }) => {
    return runGitlabTool('gitlab_update_issue', input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();
      const iid = Number(input.iid);
      if (!Number.isFinite(iid)) {
        throw new GitlabApiError('缺少 Issue 的 iid（先用 gitlab_list_issues 拿到）', 0, false);
      }
      const body: Record<string, unknown> = {};
      if (input.title !== undefined) body.title = input.title.trim();
      if (input.description !== undefined) body.description = input.description;
      if (input.state !== undefined) body.state = input.state;
      if (input.labels !== undefined) body.labels = input.labels.trim();
      if (input.assignee_id !== undefined) body.assignee_id = input.assignee_id;
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
      const result = await gitlabRequest<GitlabIssue>({
        method: 'PUT',
        path: '/projects/' + encodeProjectId(project) + '/issues/' + iid,
        body,
      });
      return {
        project,
        iid: result.data?.iid ?? iid,
        title: result.data?.title ?? null,
        state: result.data?.state ?? null,
        labels: result.data?.labels ?? [],
        updated_at: result.data?.updated_at ?? null,
        url: result.data?.web_url ?? null,
        changes: body,
      };
    });
  },
  {
    name: 'gitlab_update_issue',
    description:
      '改 Issue 的标题、正文、状态、标签或负责人。写操作，改之前先读当前状态、跟用户确认。',
    schema: z.object({
      project: z.string().describe('项目路径，形如 组名/项目名'),
      iid: z.number().int().describe('Issue 的 iid，来自 gitlab_list_issues'),
      title: z.string().optional().describe('新标题'),
      description: z.string().optional().describe('新正文'),
      state: z.enum(['opened', 'closed']).optional().describe('新状态'),
      labels: z.string().optional().describe('新标签，逗号分隔'),
      assignee_id: z.number().int().optional().describe('新负责人用户 ID'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要修改的字段，不真的改动，默认 false'),
    }),
  }
);

export const gitlabAddCommentTool = tool(
  async (input: { project: string; iid: number; body: string; dry_run?: boolean }) => {
    return runGitlabTool('gitlab_add_comment', input.project, async () => {
      const project = requireProject(input.project);
      requireWritable();
      const iid = Number(input.iid);
      if (!Number.isFinite(iid)) {
        throw new GitlabApiError('缺少 Issue 的 iid（先用 gitlab_list_issues 拿到）', 0, false);
      }
      const bodyProblem = checkCommentBody(input.body ?? '');
      if (bodyProblem) throw new GitlabApiError(bodyProblem, 0, false);
      const encoded = encodeProjectId(project);
      if (input.dry_run) {
        return {
          dry_run: true,
          project,
          iid,
          message: '演练模式：只返回将要追加的评论，没有真的发送',
        };
      }
      const issue = await gitlabRequest<GitlabIssue>({
        method: 'GET',
        path: '/projects/' + encoded + '/issues/' + iid,
        idempotent: true,
      });
      const note = await gitlabRequest<GitlabNote>({
        method: 'POST',
        path: '/projects/' + encoded + '/issues/' + iid + '/notes',
        body: { body: input.body },
      });
      const issueUrl = issue.data?.web_url ?? null;
      return {
        project,
        iid,
        note_id: note.data?.id ?? null,
        created_at: note.data?.created_at ?? null,
        url: issueUrl ? issueUrl + '#note_' + note.data?.id : null,
      };
    });
  },
  {
    name: 'gitlab_add_comment',
    description:
      '给 Issue 追加一条评论（只能追加，不能改别人的评论或删评论）。' +
      '写操作，发送前先给用户看一遍要发的内容。',
    schema: z.object({
      project: z.string().describe('项目路径，形如 组名/项目名'),
      iid: z.number().int().describe('Issue 的 iid，来自 gitlab_list_issues'),
      body: z.string().describe('评论正文'),
      dry_run: z
        .boolean()
        .optional()
        .describe('演练模式：只返回将要发送的评论，不真的发送，默认 false'),
    }),
  }
);
