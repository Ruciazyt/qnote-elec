export function checkProjectAllowed(
  project: string,
  allowedProjects: string[]
): string | null {
  const target = project.trim().toLowerCase();
  if (!target) return '缺少项目路径';
  if (!allowedProjects.length) return null;
  const hit = allowedProjects.some((item) => item.trim().toLowerCase() === target);
  if (hit) return null;
  return '项目「' + project + '」不在允许操作的白名单里。可操作的项目：' + allowedProjects.join('、');
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
  return readOnly ? 'GitLab 处于只读模式，所有写操作已被阻断' : null;
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
  if (info.protected) return '分支「' + branch + '」受保护，不能直接提交改动，请改用 Merge Request';
  return null;
}