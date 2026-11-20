// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resetGitlabConfig } from './config';
import {
  gitlabCreateBranchTool,
  gitlabGetIssueTool,
  gitlabGetJobLogsTool,
  gitlabListIssuesTool,
  gitlabListProjectsTool,
} from './index';

interface FakeRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let baseUrl = '';
const received: FakeRequest[] = [];

function sendJson(res: http.ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body);
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = req.url ?? '';
      received.push({ method: req.method ?? 'GET', url, headers: req.headers, body });

      if (!req.headers['private-token']) {
        sendJson(res, 401, { message: '401 Unauthorized' });
        return;
      }

      if (url.startsWith('/api/v4/version')) {
        sendJson(res, 200, { version: '19.2.10', revision: 'abc' });
        return;
      }
      if (url.startsWith('/api/v4/user')) {
        sendJson(res, 200, { username: 'tester', name: '测试员' });
        return;
      }
      if (url.startsWith('/api/v4/projects?')) {
        const page = new URL(url, 'http://localhost').searchParams.get('page');
        if (page === '2') {
          sendJson(res, 200, [{ id: 2, path_with_namespace: '组/项目二', default_branch: 'main' }]);
          return;
        }
        sendJson(
          res,
          200,
          [
            {
              id: 1,
              path_with_namespace: '组/项目一',
              default_branch: 'main',
              last_activity_at: '2026-11-20T00:00:00Z',
              visibility: 'private',
              web_url: 'https://gitlab.test/组/项目一',
            },
          ],
          { 'X-Next-Page': '2', 'X-Total': '2' }
        );
        return;
      }
      if (url.includes('/repository/branches/feature/new')) {
        sendJson(res, 200, { name: 'feature/new', commit: { id: 'abc123' } });
        return;
      }
      if (url.endsWith('/repository/branches')) {
        sendJson(res, 201, { name: 'feature/new', commit: { id: 'abc123' } });
        return;
      }
      if (url.includes('/issues/999')) {
        sendJson(res, 404, { message: '404 Issue Not Found' });
        return;
      }
      if (url.includes('/issues/')) {
        sendJson(res, 200, {
          iid: 7,
          title: '示例 Issue',
          description: '正文内容',
          state: 'opened',
          labels: ['bug'],
          assignees: [{ username: 'tester' }],
          web_url: 'https://gitlab.test/组/项目一/-/issues/7',
        });
        return;
      }
      if (url.includes('/issues?')) {
        sendJson(res, 200, [{ iid: 7, title: '示例 Issue', state: 'opened', labels: ['bug'] }]);
        return;
      }
      if (url.includes('/trace')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('build ok\nERROR: boom\ntail line\n');
        return;
      }
      sendJson(res, 404, { message: '404 Not Found' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = 'http://127.0.0.1:' + address.port;
  process.env.GITLAB_BASE_URL = baseUrl;
  process.env.GITLAB_TOKEN = 'test-token';
  resetGitlabConfig();
});

afterAll(async () => {
  delete process.env.GITLAB_BASE_URL;
  delete process.env.GITLAB_TOKEN;
  resetGitlabConfig();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received.length = 0;
});

describe('GitLab 工具链路', () => {
  it('实例自检通过后列出项目，并能用 next_cursor 翻页', async () => {
    const first = JSON.parse(
      String(await gitlabListProjectsTool.invoke({ limit: 1 }))
    ) as Record<string, any>;
    expect(first.ok).toBe(true);
    expect(first.projects[0].path).toBe('组/项目一');
    expect(first.next_cursor).toBeTruthy();

    const second = JSON.parse(
      String(await gitlabListProjectsTool.invoke({ cursor: first.next_cursor }))
    ) as Record<string, any>;
    expect(second.ok).toBe(true);
    expect(second.projects[0].path).toBe('组/项目二');
    expect(second.next_cursor).toBeNull();
  });

  it('认证头用 PRIVATE-TOKEN 而不是 Authorization', async () => {
    await gitlabListProjectsTool.invoke({});
    const call = received.find((item) => item.url.startsWith('/api/v4/projects'));
    expect(call?.headers['private-token']).toBe('test-token');
    expect(call?.headers.authorization).toBeUndefined();
  });

  it('建分支按业务语义校验分支名', async () => {
    const bad = JSON.parse(
      String(await gitlabCreateBranchTool.invoke({ project: '组/项目一', branch: 'main', ref: 'main' }))
    ) as Record<string, any>;
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('feature/');

    const ok = JSON.parse(
      String(
        await gitlabCreateBranchTool.invoke({
          project: '组/项目一',
          branch: 'feature/new',
          ref: 'main',
        })
      )
    ) as Record<string, any>;
    expect(ok.ok).toBe(true);
    expect(ok.branch).toBe('feature/new');
  });

  it('列表类工具按字段裁剪返回', async () => {
    const issues = JSON.parse(
      String(await gitlabListIssuesTool.invoke({ project: '组/项目一' }))
    ) as Record<string, any>;
    expect(issues.ok).toBe(true);
    expect(issues.issues[0]).toEqual({
      iid: 7,
      title: '示例 Issue',
      state: 'opened',
      labels: ['bug'],
      updated_at: null,
      url: null,
    });
  });

  it('不存在的 IID 返回可行动的 404 文案', async () => {
    const result = JSON.parse(
      String(await gitlabGetIssueTool.invoke({ project: '组/项目一', iid: 999 }))
    ) as Record<string, any>;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('先用列表类工具确认');
  });

  it('job 日志返回尾部与命中行', async () => {
    const logs = JSON.parse(
      String(await gitlabGetJobLogsTool.invoke({ project: '组/项目一', job_id: 42 }))
    ) as Record<string, any>;
    expect(logs.ok).toBe(true);
    expect(logs.total_lines).toBe(3);
    expect(logs.matched_lines).toContain('ERROR: boom');
  });
});
