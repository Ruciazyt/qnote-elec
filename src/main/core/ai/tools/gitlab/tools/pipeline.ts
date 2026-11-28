import { tool } from "../../tool";
import { z } from 'zod';
import { GitlabApiError, gitlabRequest } from '../api/client';
import { gitlabEndpoints } from '../api/endpoints';
import { getGitlabConfig } from '../runtime/config';
import { capText, clampLimit, listWithCursor, requireProject, runGitlabTool } from '../utils/helpers';
import { pickKeywordLines, redactSecrets } from '../utils/shape';
import type { GitlabJob, GitlabPipeline } from '../api/types';
import { branchSchema, paginationShape, projectSchema, strictObject } from '../schemas/input';

const DEFAULT_LOG_KEYWORDS = ['error', 'fail', 'exception', 'fatal', 'denied', 'timeout'];

export const gitlabListPipelinesTool = tool(
  async (input: {
    project: string;
    ref?: string;
    status?: string;
    limit?: number;
    cursor?: string;
  }) => {
    return runGitlabTool('gitlab_list_pipelines', input.project, async () => {
      const project = requireProject(input.project);
      const limit = clampLimit(input.limit, 20, 100);
      const page = await listWithCursor<GitlabPipeline>({
        kind: 'pipelines:' + project,
        path: gitlabEndpoints.pipelines(project),
        query: {
          ref: input.ref?.trim() || undefined,
          status: input.status?.trim() || undefined,
          order_by: 'updated_at',
          sort: 'desc',
        },
        cursor: input.cursor,
        perPage: limit,
      });
      const pipelines = page.items.map((item) => ({
        id: item.id,
        ref: item.ref,
        status: item.status,
        source: item.source,
        sha: item.sha ?? null,
        created_at: item.created_at ?? null,
        updated_at: item.updated_at ?? null,
        duration: item.duration ?? null,
        url: item.web_url ?? null,
      }));
      return {
        count: pipelines.length,
        total: page.total,
        pipelines,
        next_cursor: page.nextCursor,
        next_hint: page.nextCursor
          ? '还有更多流水线，把 next_cursor 原样传回本工具即可继续取下一页'
          : null,
      };
    });
  },
  {
    name: 'gitlab_list_pipelines',
    description:
      '列出项目的 CI 流水线，返回流水线 id、分支、状态、来源、耗时。' +
      '排查 CI 问题时先看这里，拿到 pipeline id 再调 gitlab_get_pipeline。',
    schema: strictObject({
      project: projectSchema.describe('项目路径，形如 组名/项目名'),
      ref: branchSchema.optional().describe('只看某个分支的流水线，可选'),
      status: z.string().optional().describe('按状态过滤，如 failed、success，可选'),
      ...paginationShape,
    }),
  }
);

export const gitlabGetPipelineTool = tool(
  async (input: {
    project: string;
    pipeline_id: number;
    job_limit?: number;
    job_cursor?: string;
  }) => {
    return runGitlabTool('gitlab_get_pipeline', input.project, async () => {
      const project = requireProject(input.project);
      const pipelineId = Number(input.pipeline_id);
      if (!Number.isFinite(pipelineId)) {
        throw new GitlabApiError('缺少流水线 id（先用 gitlab_list_pipelines 拿到）', 0, false);
      }
      const pipeline = await gitlabRequest<GitlabPipeline>({
        method: 'GET',
        path: gitlabEndpoints.pipeline(project, pipelineId),
        idempotent: true,
      });
      const jobLimit = clampLimit(input.job_limit, 20, 100);
      const jobs = await listWithCursor<GitlabJob>({
        kind: 'jobs:' + project + ':' + pipelineId,
        path: gitlabEndpoints.pipelineJobs(project, pipelineId),
        query: {},
        cursor: input.job_cursor,
        perPage: jobLimit,
      });

      const allJobs = jobs.items.map((item) => ({
        id: item.id,
        name: item.name,
        stage: item.stage,
        status: item.status,
        duration: item.duration ?? null,
        allow_failure: item.allow_failure === true,
        url: item.web_url ?? null,
      }));

      let shown = allJobs;
      let trimmed = false;
      if (allJobs.length > 20) {
        const failed = allJobs.filter((job) => job.status === 'failed');
        const slowest = [...allJobs]
          .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
          .slice(0, 10);
        const seen = new Set<number>();
        shown = [...failed, ...slowest].filter((job) => {
          if (seen.has(job.id)) return false;
          seen.add(job.id);
          return true;
        });
        trimmed = true;
      }

      return {
        pipeline_id: pipeline.data?.id ?? pipelineId,
        status: pipeline.data?.status ?? null,
        ref: pipeline.data?.ref ?? null,
        sha: pipeline.data?.sha ?? null,
        source: pipeline.data?.source ?? null,
        created_at: pipeline.data?.created_at ?? null,
        updated_at: pipeline.data?.updated_at ?? null,
        duration: pipeline.data?.duration ?? null,
        url: pipeline.data?.web_url ?? null,
        job_count: allJobs.length,
        job_next_cursor: jobs.nextCursor,
        jobs: shown,
        jobs_truncated: trimmed,
        job_hint: trimmed
          ? 'job 太多，只回了失败的和最慢的几个；要看全部用 job id 逐个查日志'
          : jobs.nextCursor
            ? 'job_count 是这一页的数量，还有更多 job 时带着 job_next_cursor 再调一次'
            : '要失败 job 的日志，用 gitlab_get_job_logs 传它的 job id',
      };
    });
  },
  {
    name: 'gitlab_get_pipeline',
    description:
      '读一条流水线的状态和它下面的 job 列表（id、名字、阶段、状态、耗时）。' +
      'pipeline_id 来自 gitlab_list_pipelines。job 太多时只回失败与最慢的几个，' +
      'job_count 是这一页的数量，还有更多时用 job_next_cursor 继续翻。',
    schema: strictObject({
      project: projectSchema.describe('项目路径，形如 组名/项目名'),
      pipeline_id: z.number().int().describe('流水线 id，来自 gitlab_list_pipelines'),
      job_limit: z.number().int().min(1).max(100).optional().describe('最多取多少个 job，默认 20'),
      job_cursor: z.string().optional().describe('翻页句柄，来自上一次返回的 job_next_cursor'),
    }),
  }
);

export const gitlabGetJobLogsTool = tool(
  async (input: {
    project: string;
    job_id: number;
    start_line?: number;
    max_lines?: number;
    grep?: string;
  }) => {
    return runGitlabTool('gitlab_get_job_logs', input.project, async () => {
      const project = requireProject(input.project);
      const jobId = Number(input.job_id);
      if (!Number.isFinite(jobId)) {
        throw new GitlabApiError('缺少 job id（先用 gitlab_get_pipeline 拿到）', 0, false);
      }
      const trace = await gitlabRequest<string>({
        method: 'GET',
        path: gitlabEndpoints.jobTrace(project, jobId),
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

      const cfg = getGitlabConfig();
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
    name: 'gitlab_get_job_logs',
    description:
      '读某个 CI job 的日志：默认给开头若干行，外加全文里命中关键词（error/fail/exception 等）的行。' +
      '日志很长时用 start_line 翻页。job id 来自 gitlab_get_pipeline。',
    schema: strictObject({
      project: projectSchema.describe('项目路径，形如 组名/项目名'),
      job_id: z.number().int().describe('job id，来自 gitlab_get_pipeline'),
      start_line: z.number().int().min(1).optional().describe('从第几行开始，默认 1'),
      max_lines: z.number().int().min(1).max(1000).optional().describe('本次最多取多少行，默认 200，最多 1000'),
      grep: z.string().optional().describe('自定义关键词，命中行会单独列出'),
    }),
  }
);
