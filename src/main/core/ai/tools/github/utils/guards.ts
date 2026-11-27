export function checkRepositoryFormat(repository: string): string | null {
  const value = repository.trim();
  if (!value) return '缺少仓库名';
  if (!/^[^/\s]+\/[^/\s]+$/.test(value)) {
    return '仓库名「' + value + '」不合规，必须是 owner/repo 形式';
  }
  return null;
}

export function checkRepositoryAllowed(
  repository: string,
  allowedRepositories: string[]
): string | null {
  const target = repository.trim().toLowerCase();
  if (!target) return '缺少仓库名';
  if (!allowedRepositories.length) return null;
  const hit = allowedRepositories.some((item) => item.trim().toLowerCase() === target);
  if (hit) return null;
  return '仓库「' + repository + '」不在允许操作的白名单里。可操作的仓库：' + allowedRepositories.join('、');
}

export function checkBranchName(branch: string): string | null {
  const name = branch.trim();
  if (!name) return '分支名不能为空';
  if (!/^(feature|fix)\//.test(name)) {
    return '分支名「' + name + '」不合规，只能以 feature/ 或 fix/ 开头';
  }
  if (!/^[A-Za-z0-9._\-/]+$/.test(name)) {
    return '分支名「' + name + '」包含非法字符，只允许字母、数字、. _ - /';
  }
  if (name.length > 120) return '分支名过长';
  return null;
}

export function checkWriteAllowed(readOnly: boolean): string | null {
  return readOnly ? 'GitHub 处于只读模式，所有写操作已被阻断' : null;
}

export function checkCommentBody(body: string): string | null {
  const text = body.trim();
  if (!text) return '评论内容不能为空';
  if (text.length > 100000) return '评论内容过长';
  return null;
}

export function checkWritableBranch(
  branch: string,
  info: { protected?: boolean; default?: boolean }
): string | null {
  if (info.default) return '分支「' + branch + '」是默认分支，不能直接提交改动';
  if (info.protected) return '分支「' + branch + '」受保护，不能直接提交改动，请改用 Pull Request';
  return null;
}
