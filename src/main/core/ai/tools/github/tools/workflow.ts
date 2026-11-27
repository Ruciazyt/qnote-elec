import { tool } from "../../tool";
import { z } from 'zod';
import { GithubApiError, githubRequest, parseLinkHeader } from '../api/client';
import { githubEndpoints } from '../api/endpoints';
import { getGithubConfig } from '../runtime/config';
import {
  capText,
  clampLimit,
  listWithCursorUsing,
  requireRepository,
  runGithubTool,
} from '../utils/helpers';
import { pickKeywordLines, redactSecrets } from '../utils/shape';
import type { GitHubJob, GitHubWorkflowRun } from '../api/types';
import { branchSchema, paginationShape, repositorySchema, strictObject } from '../schemas/input';

const DEFAULT_LOG_KEYWORDS = ['error', 'fail', 'exception', 'fatal', 'denied', 'timeout'];

export const githubListWorkflowRunsTool = tool(
  async (input: {
    repository: string;
    ref?: string;
    limit?: number;
    cursor?: string;
  }) => {
    return runGithubTool('github_list_workflow_runs', input.repository, async () => {
      const repository = requireRepository(input.repository);
      const limit = clampLimit(input.limit, 20, 100);
      const page = await listWithCursorUsing<GitHubWorkflowRun>(
        {
          kind: 'workflow-runs:' + repository,
          path: githubEndpoints.workflowRuns(repository),
          query: { branch: input.ref?.trim() || undefined },
          cursor: input.cursor,
          perPage: limit,
        },
        async (path, query, pageNumber, perPage) => {
          const result = await githubRequest<{ workflow_runs?: GitHubWorkflowRun[] }>({
            method: 'GET',
            path,
            query: { ...query, page: pageNumber, per_page: perPage },
            idempotent: true,
          });
          const link = parseLinkHeader(result.headers['link']);
          return {
            items: result.data.workflow_runs ?? [],
            nextPage: link.nextPage,
            total: null,
          };
        }
      );
      const runs = page.items.map((item) => ({
        id: item.id,
        name: item.name ?? null,
        status: item.status ?? null,
        conclusion: item.conclusion ?? null,
        branch: item.head_branch ?? null,
        sha: item.head_sha?.slice(0, 8) ?? null,
        created_at: item.created_at ?? null,
        updated_at: item.updated_at ?? null,
        url: item.html_url ?? null,
      }));
      return {
        count: runs.length,
        total: page.total,
        workflow_runs: runs,
        next_cursor: page.nextCursor,
        next_hint: page.nextCursor
          ? '还有更多运行记录，把 next_cursor 原样传回本工具即可继续取下一页'
          : null,
      };
    });
  },
  {
    name: 'github_list_workflow_runs',
    description:
      '列出仓库的 GitHub Actions 运行记录，返回运行 id、工作流名、状态与结论、分支、提交。' +
      '排查 CI 问题时先看这里，拿到 run id 再调 github_get_workflow_run。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      ref: branchSchema.optional().describe('只看某个分支的运行记录，可选'),
      ...paginationShape,
    }),
  }
);

export const githubGetWorkflowRunTool = tool(
  async (input: { repository: string; run_id: number; job_limit?: number }) => {
    return runGithubTool('github_get_workflow_run', input.repository, async () => {
      const repository = requireRepository(input.repository);
      const runId = Number(input.run_id);
      if (!Number.isFinite(runId)) {
        throw new GithubApiError('缺少运行 id（先用 github_list_workflow_runs 拿到）', 0, false);
      }
      const run = await githubRequest<GitHubWorkflowRun>({
        method: 'GET',
        path: githubEndpoints.workflowRun(repository, runId),
        idempotent: true,
      });
      const jobLimit = clampLimit(input.job_limit, 20, 100);
      const jobs = await listWithCursorUsing<GitHubJob>(
        {
          kind: 'jobs:' + repository + ':' + runId,
          path: githubEndpoints.workflowJobs(repository, runId),
          query: {},
          perPage: jobLimit,
        },
        async (path, query, pageNumber, perPage) => {
          const result = await githubRequest<{ jobs?: GitHubJob[] }>({
            method: 'GET',
            path,
            query: { ...query, page: pageNumber, per_page: perPage },
            idempotent: true,
          });
          const link = parseLinkHeader(result.headers['link']);
          return {
            items: result.data.jobs ?? [],
            nextPage: link.nextPage,
            total: null,
          };
        }
      );

      const allJobs = jobs.items.map((item) => ({
        id: item.id,
        name: item.name ?? null,
        status: item.status ?? null,
        conclusion: item.conclusion ?? null,
        started_at: item.started_at ?? null,
        completed_at: item.completed_at ?? null,
        url: item.html_url ?? null,
      }));

      let shown = allJobs;
      let trimmed = false;
      if (allJobs.length > 20) {
        const failed = allJobs.filter((job) => job.conclusion === 'failure');
        const seen = new Set<number>();
        shown = allJobs.filter((job) => {
          if (seen.has(job.id)) return false;
          seen.add(job.id);
          return true;
        });
        trimmed = failed.length > 0;
      }

      return {
        run_id: run.data?.id ?? runId,
        name: run.data?.name ?? null,
        status: run.data?.status ?? null,
        conclusion: run.data?.conclusion ?? null,
        branch: run.data?.head_branch ?? null,
        sha: run.data?.head_sha ?? null,
        created_at: run.data?.created_at ?? null,
        updated_at: run.data?.updated_at ?? null,
        url: run.data?.html_url ?? null,
        job_count: allJobs.length,
        jobs: shown,
        jobs_truncated: trimmed,
        job_hint: '要失败 job 的日志，用 github_get_job_logs 传它的 job id',
      };
    });
  },
  {
    name: 'github_get_workflow_run',
    description:
      '读一次 Actions 运行的详情和它下面的 job 列表（id、名字、状态、结论）。' +
      'run_id 来自 github_list_workflow_runs。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      run_id: z.number().int().describe('运行 id，来自 github_list_workflow_runs'),
      job_limit: z.number().int().min(1).max(100).optional().describe('最多取多少个 job，默认 20'),
    }),
  }
);

export const githubGetJobLogsTool = tool(
  async (input: {
    repository: string;
    job_id: number;
    start_line?: number;
    max_lines?: number;
    grep?: string;
  }) => {
    return runGithubTool('github_get_job_logs', input.repository, async () => {
      const repository = requireRepository(input.repository);
      const jobId = Number(input.job_id);
      if (!Number.isFinite(jobId)) {
        throw new GithubApiError('缺少 job id（先用 github_get_workflow_run 拿到）', 0, false);
      }
      const trace = await githubRequest<string>({
        method: 'GET',
        path: githubEndpoints.jobLogs(repository, jobId),
        raw: true,
        idempotent: true,
      });
      const text = redactSecrets(String(trace.data ?? ''));
      const normalized = text.replace(/\n$/, '');
      const lines = normalized.length > 0 ? normalized.split('\n') : [];
      const totalLines = lines.length;
      const maxLines = clampLimit(input.max_lines, 200, 1000);
      const startLine = Math.max(1, Math.floor(input.start_line ?? 1));
      const slice = lines.slice(startLine - 1, startLine - 1 + maxLines);
      const keywords = input.grep?.trim() ? [input.grep.trim()] : DEFAULT_LOG_KEYWORDS;
      const matched = pickKeywordLines(lines, keywords, 40);

      const cfg = getGithubConfig();
      const capped = await capText(slice.join('\n'), 'job-' + jobId + '-log', cfg.maxResultTokens);
      const nextStartLine =
        startLine - 1 + slice.length < totalLines ? startLine + slice.length : null;

      return {
        job_id: jobId,
        total_lines: totalLines,
        start_line: startLine,
        returned_lines: slice.length,
        next_start_line: nextStartLine,
        logs: capped.text,
        logs_truncated: capped.truncated,
        full_log_path: capped.fullPath,
        matched_lines: matched,
        match_hint:
          'matched_lines 是整份日志里命中关键词的行；继续看后面用 start_line，想看全部读 full_log_path',
      };
    });
  },
  {
    name: 'github_get_job_logs',
    description:
      '读某个 Actions job 的日志：默认给前若干行，外加全文里命中关键词（error/fail/exception 等）的行。' +
      '日志很长时用 start_line 翻页。job id 来自 github_get_workflow_run。',
    schema: strictObject({
      repository: repositorySchema.describe('仓库全名，形如 owner/repo'),
      job_id: z.number().int().describe('job id，来自 github_get_workflow_run'),
      start_line: z.number().int().min(1).optional().describe('从第几行开始，默认 1'),
      max_lines: z.number().int().min(1).max(1000).optional().describe('本次最多取多少行，默认 200，最多 1000'),
      grep: z.string().optional().describe('自定义关键词，命中行会单独列出'),
    }),
  }
);
