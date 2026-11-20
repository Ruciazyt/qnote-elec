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

export function describeStatus(status: number, body: string): string {
  const detail = extractApiMessage(body);
  const suffix = detail ? '：' + detail : '';
  if (status === 401) return 'token 已失效或过期（401），需要重新签发 Personal Access Token' + suffix;
  if (status === 403) return '权限不足或目标受保护（403），检查 PAT scope、分支保护规则与账号角色' + suffix;
  if (status === 404) return '项目路径、分支名或 IID 不存在（404），先用列表类工具确认' + suffix;
  if (status === 409) return '目标状态冲突（409），先读取当前状态再决定' + suffix;
  if (status === 400 || status === 422) return '请求参数不被接受（' + status + '）' + (suffix || '字段校验未通过');
  if (status === 429) return '触发 GitLab 限流（429），退避后重试';
  if (status >= 500) return 'GitLab 服务端错误（' + status + '），可退避重试' + suffix;
  return '请求失败（HTTP ' + status + '）' + suffix;
}
