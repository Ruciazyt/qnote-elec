import { afterEach, describe, expect, it } from 'vitest';
import {
  checkBranchName,
  checkCommentBody,
  checkRepositoryAllowed,
  checkRepositoryFormat,
  checkWritableBranch,
  checkWriteAllowed,
} from '../utils/guards';
import { estimateTokens, pickKeywordLines, redactSecrets, truncateByTokens } from '../utils/shape';
import { clearCursors, issueCursor, readCursor } from '../../shared/cursor';
import { describeStatus, isRateLimited } from '../api/errors';
import { encodeRepositoryId } from '../api/endpoints';
import { getGithubConfig, isGithubConfigured, resetGithubConfig } from '../runtime/config';

describe('GitHub 护栏', () => {
  it('仓库名必须是 owner/repo', () => {
    expect(checkRepositoryFormat('owner/repo')).toBeNull();
    expect(checkRepositoryFormat('repo')).toContain('owner/repo');
    expect(checkRepositoryFormat('a/b/c')).toContain('owner/repo');
  });

  it('白名单为空时不做限制', () => {
    expect(checkRepositoryAllowed('owner/repo', [])).toBeNull();
  });

  it('白名单命中放行', () => {
    expect(checkRepositoryAllowed('owner/repo', ['owner/repo'])).toBeNull();
    expect(checkRepositoryAllowed('Owner/Repo', ['owner/repo'])).toBeNull();
  });

  it('白名单不命中给出可行动提示', () => {
    const problem = checkRepositoryAllowed('owner/repo', ['other/repo']);
    expect(problem).toContain('白名单');
    expect(problem).toContain('other/repo');
  });

  it('分支名只接受 feature/ 与 fix/ 开头', () => {
    expect(checkBranchName('feature/login')).toBeNull();
    expect(checkBranchName('fix/typo')).toBeNull();
    expect(checkBranchName('main')).toContain('feature/');
    expect(checkBranchName('feature/带中文')).toContain('非法字符');
  });

  it('受保护分支与默认分支拒绝直接提交', () => {
    expect(checkWritableBranch('main', { default: true })).toContain('默认分支');
    expect(checkWritableBranch('release', { protected: true })).toContain('受保护');
    expect(checkWritableBranch('feature/x', { protected: false, default: false })).toBeNull();
  });

  it('只读模式阻断写操作', () => {
    expect(checkWriteAllowed(true)).toContain('只读');
    expect(checkWriteAllowed(false)).toBeNull();
  });

  it('评论内容不能为空', () => {
    expect(checkCommentBody('  ')).toContain('不能为空');
    expect(checkCommentBody('ok')).toBeNull();
  });
});

describe('GitHub 返回体积与脱敏', () => {
  it('中文按一字一 token 估算', () => {
    expect(estimateTokens('中文')).toBe(2);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('')).toBe(0);
  });

  it('超限时截断并标记', () => {
    const long = 'a'.repeat(40000);
    const capped = truncateByTokens(long, 100);
    expect(capped.truncated).toBe(true);
    expect(capped.text.length).toBeLessThan(long.length);
    expect(truncateByTokens('short', 100).truncated).toBe(false);
  });

  it('敏感令牌先脱敏', () => {
    expect(redactSecrets('token ghp_abcdefgh12345678 here')).toContain('[已脱敏的令牌]');
    expect(redactSecrets('token ghp_abcdefgh12345678 here')).not.toContain('ghp_abcdefgh');
    expect(redactSecrets('Authorization: Bearer supersecretvalue')).toContain('[已脱敏的令牌]');
  });

  it('关键词命中行单独挑出', () => {
    const lines = ['build ok', 'ERROR: boom', 'done'];
    expect(pickKeywordLines(lines, ['error'], 10)).toEqual(['ERROR: boom']);
  });
});

describe('GitHub 续取句柄', () => {
  afterEach(() => {
    clearCursors();
  });

  it('句柄能还原分页状态', () => {
    const cursor = issueCursor({ kind: 'issues', path: '/repos/o/r/issues', query: { state: 'open' }, page: 2, perPage: 20 });
    const state = readCursor(cursor);
    expect(state).not.toBeNull();
    expect(state?.kind).toBe('issues');
    expect(state?.page).toBe(2);
    expect(state?.query.state).toBe('open');
  });

  it('未知句柄返回 null', () => {
    expect(readCursor('gc_not_a_real_cursor')).toBeNull();
  });

  it('句柄最多用五次', () => {
    const cursor = issueCursor({ kind: 'issues', path: '/p', query: {}, page: 2, perPage: 20 });
    for (let i = 0; i < 5; i += 1) {
      expect(readCursor(cursor)).not.toBeNull();
    }
    expect(readCursor(cursor)).toBeNull();
  });
});

describe('GitHub 错误文案', () => {
  it('每个状态码都给出可行动提示', () => {
    expect(describeStatus(401, '')).toContain('重新签发');
    expect(describeStatus(403, '')).toContain('权限不足');
    expect(describeStatus(404, '')).toContain('先用列表类工具确认');
    expect(describeStatus(405, '')).toContain('不可合并');
    expect(describeStatus(409, '')).toContain('先读取当前状态');
    expect(describeStatus(422, '{"message":["title is missing"]}')).toContain('title is missing');
    expect(describeStatus(429, '')).toContain('限流');
    expect(describeStatus(503, '')).toContain('服务端错误');
  });

  it('配额耗尽的 403 判成限流', () => {
    expect(isRateLimited(403, 'API rate limit exceeded', { 'x-ratelimit-remaining': '0' })).toBe(true);
    expect(describeStatus(403, 'API rate limit exceeded', { 'x-ratelimit-remaining': '0' })).toContain('限流');
    expect(isRateLimited(403, 'Resource not accessible', { 'x-ratelimit-remaining': '4999' })).toBe(false);
  });

  it('仓库名做 URL 编码', () => {
    expect(encodeRepositoryId('owner/repo')).toBe('owner/repo');
    expect(encodeRepositoryId('owner/组')).toContain('%E7%BB%84');
  });
});

describe('GitHub 配置', () => {
  afterEach(() => {
    delete process.env.GITHUB_BASE_URL;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_ALLOWED_REPOSITORIES;
    delete process.env.GITHUB_READ_ONLY;
    resetGithubConfig();
  });

  it('默认走公共 API 端点，去掉结尾斜杠', () => {
    process.env.GITHUB_BASE_URL = 'https://github.example.com/api/v3/';
    process.env.GITHUB_TOKEN = 'ghp-test';
    resetGithubConfig();
    expect(getGithubConfig().baseUrl).toBe('https://github.example.com/api/v3');
    expect(isGithubConfigured()).toBe(true);
  });

  it('白名单与环境变量里的只读开关生效', () => {
    process.env.GITHUB_ALLOWED_REPOSITORIES = 'owner/a, owner/b';
    process.env.GITHUB_READ_ONLY = 'true';
    resetGithubConfig();
    const cfg = getGithubConfig();
    expect(cfg.allowedRepositories).toEqual(['owner/a', 'owner/b']);
    expect(cfg.readOnly).toBe(true);
  });

  it('没有令牌时视为未配置', () => {
    process.env.GITHUB_TOKEN = '';
    resetGithubConfig();
    expect(isGithubConfigured()).toBe(false);
  });
});
