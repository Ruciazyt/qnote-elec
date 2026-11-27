function extractApiMessage(body: string): string {
  const text = body.trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const raw = parsed.message ?? parsed.error;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) return raw.map((item) => String(item)).join('; ');
    if (raw && typeof raw === 'object') {
      return Object.entries(raw as Record<string, unknown>)
        .map((entry) => entry[0] + ': ' + JSON.stringify(entry[1]))
        .join('; ');
    }
  } catch {
    return text.slice(0, 300);
  }
  return text.slice(0, 300);
}

export function isRateLimited(
  status: number,
  body: string,
  headers?: Record<string, string>
): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  const remaining = headers?.['x-ratelimit-remaining'];
  if (remaining !== undefined && remaining === '0') return true;
  const message = extractApiMessage(body).toLowerCase();
  return message.includes('rate limit') || message.includes('secondary rate');
}

export function describeStatus(
  status: number,
  body: string,
  headers?: Record<string, string>
): string {
  const detail = extractApiMessage(body);
  const suffix = detail ? '：' + detail : '';
  if (status === 401) return 'token 无效或已过期（401），需要重新签发 GitHub token' + suffix;
  if (status === 403) {
    if (isRateLimited(status, body, headers)) {
      return '触发 GitHub 限流（403，配额耗尽），退避后重试' + suffix;
    }
    return '权限不足或目标受保护（403），检查 token 权限、分支保护规则与账号角色' + suffix;
  }
  if (status === 404) return '仓库、分支名或编号不存在（404），先用列表类工具确认' + suffix;
  if (status === 405) return '当前状态不允许该操作（405），例如 PR 不可合并或分支已存在' + suffix;
  if (status === 409) return '目标状态冲突（409），先读取当前状态再决定' + suffix;
  if (status === 400 || status === 422) return '请求参数不被接受（' + status + '）' + (suffix || '字段校验未通过');
  if (status === 429) return '触发 GitHub 限流（429），退避后重试';
  if (status >= 500) return 'GitHub 服务端错误（' + status + '），可退避重试' + suffix;
  return '请求失败（HTTP ' + status + '）' + suffix;
}
