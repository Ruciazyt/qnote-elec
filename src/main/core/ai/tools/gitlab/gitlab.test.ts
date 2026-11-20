import { afterEach, describe, expect, it } from 'vitest';
import { checkBranchName, checkCommentBody, checkProjectAllowed, checkWritableBranch, checkWriteAllowed } from './guards';
import { estimateTokens, pickKeywordLines, redactSecrets, truncateByTokens } from './shape';
import { clearCursors, issueCursor, readCursor } from './cursor';
import { describeStatus } from './errors';
import { encodeProjectId } from './client';
import { getGitlabConfig, isGitlabConfigured, resetGitlabConfig } from './config';

describe('GitLab 护栏', () => {
  it('白名单为空时不做限制', () => {
    expect(checkProjectAllowed('组/项目', [])).toBeNull();
  });

  it('白名单命中放行', () => {
    expect(checkProjectAllowed('组/项目', ['组/项目'])).toBeNull();
    expect(checkProjectAllowed('组/项目', ['其他/项目', '组/项目'])).toBeNull();
  });

  it('白名单不命中给出可行动提示', () => {
    const problem = checkProjectAllowed('组/项目', ['其他/项目']);
    expect(problem).toContain('白名单');
    expect(problem).toContain('其他/项目');
  });

  it('分支名只接受 feature/ 与 fix/ 开头', () => {
    expect(checkBranchName('feature/login')).toBeNull();
    expect(checkBranchName('fix/typo')).toBeNull();
    expect(checkBranchName('main')).toContain('feature/');
    expect(checkBranchName('develop')).toContain('feature/');
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

describe('GitLab 返回体积与脱敏', () => {
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
    expect(redactSecrets('token glpat-abcdefgh12345678 here')).toContain('[已脱敏的令牌]');
    expect(redactSecrets('token glpat-abcdefgh12345678 here')).not.toContain('glpat-abcdefgh');
    expect(redactSecrets('PRIVATE-TOKEN: supersecretvalue')).toContain('[已脱敏的令牌]');
  });

  it('关键词命中行单独挑出', () => {
    const lines = ['build ok', 'ERROR: boom', 'done'];
    expect(pickKeywordLines(lines, ['error'], 10)).toEqual(['ERROR: boom']);
    expect(pickKeywordLines(lines, ['error'], 10).length).toBe(1);
  });
});

describe('GitLab 续取句柄', () => {
  afterEach(() => {
    clearCursors();
  });

  it('句柄能还原分页状态', () => {
    const cursor = issueCursor({ kind: 'issues', path: '/projects/1/issues', query: { state: 'opened' }, page: 2, perPage: 20 });
    const state = readCursor(cursor);
    expect(state).not.toBeNull();
    expect(state?.kind).toBe('issues');
    expect(state?.page).toBe(2);
    expect(state?.query.state).toBe('opened');
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

describe('GitLab 错误文案', () => {
  it('每个状态码都给出可行动提示', () => {
    expect(describeStatus(401, '')).toContain('重新签发');
    expect(describeStatus(403, '')).toContain('权限不足');
    expect(describeStatus(404, '')).toContain('先用列表类工具确认');
    expect(describeStatus(409, '')).toContain('先读取当前状态');
    expect(describeStatus(422, '{"message":["title is missing"]}')).toContain('title is missing');
    expect(describeStatus(429, '')).toContain('限流');
    expect(describeStatus(503, '')).toContain('服务端错误');
  });

  it('项目路径做 URL 编码，数字 ID 原样', () => {
    expect(encodeProjectId('组/项目')).toContain('%2F');
    expect(encodeProjectId('123')).toBe('123');
  });
});

describe('GitLab 配置', () => {
  afterEach(() => {
    delete process.env.GITLAB_BASE_URL;
    delete process.env.GITLAB_TOKEN;
    delete process.env.GITLAB_ALLOWED_PROJECTS;
    delete process.env.GITLAB_READ_ONLY;
    resetGitlabConfig();
  });

  it('环境变量优先，去掉结尾斜杠', () => {
    process.env.GITLAB_BASE_URL = 'https://gitlab.example.com/';
    process.env.GITLAB_TOKEN = 'glpat-test';
    resetGitlabConfig();
    expect(getGitlabConfig().baseUrl).toBe('https://gitlab.example.com');
    expect(isGitlabConfigured()).toBe(true);
  });

  it('白名单与环境变量里的只读开关生效', () => {
    process.env.GITLAB_ALLOWED_PROJECTS = '组A/项目1, 组A/项目2';
    process.env.GITLAB_READ_ONLY = 'true';
    resetGitlabConfig();
    const cfg = getGitlabConfig();
    expect(cfg.allowedProjects).toEqual(['组A/项目1', '组A/项目2']);
    expect(cfg.readOnly).toBe(true);
  });

  it('没有令牌时视为未配置', () => {
    process.env.GITLAB_TOKEN = '';
    resetGitlabConfig();
    expect(isGitlabConfigured()).toBe(false);
  });
});
