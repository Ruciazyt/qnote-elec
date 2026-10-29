'use strict';

/**
 * 把可执行文件名解析成绝对路径
 *
 * ## 为什么需要这个
 *
 * child_process 靠 PATH 查找命令，而 PATH 里的目录未必不可写。
 * 只要有人能在 PATH 靠前的目录里放进一个同名可执行文件，就能劫持脚本实际执行的命令。
 * 这类风险在开发机上通常是"自己坑自己"，但 SonarCloud 把它算成安全漏洞
 * （S4036 / "Untrusted Search Path"），会直接把质量门禁的 Security Rating 拉到 E。
 *
 * 解析顺序：PATH 的各个目录 → 先按原名匹配（命令自带扩展名时）→
 * 再拼平台对应的可执行后缀（Windows 读 PATHEXT）。
 * 找不到就原样返回 —— 静默换一个路径比直接失败难查得多。
 */

const fs = require('fs');
const path = require('path');

/** 一次解析缓存住结果：同一个命令在一个脚本里会被调用很多次 */
const cache = new Map();

function resolveExe(name) {
  if (path.isAbsolute(name)) return name;

  const cached = cache.get(name);
  if (cached) return cached;

  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
      : [''];

  let resolved = name;
  outer: for (const dir of dirs) {
    // 先按原名找一遍：命令名自带扩展名时（powershell.exe、git.exe）
    // 再拼 PATHEXT 会变成 powershell.exe.EXE，永远找不到
    try {
      const exact = path.join(dir, name);
      if (fs.existsSync(exact)) {
        resolved = exact;
        break outer;
      }
    } catch {
      // 目录无权限读就跳过，继续找下一个
    }
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.existsSync(candidate)) {
          resolved = candidate;
          break outer;
        }
      } catch {
        // 目录无权限读就跳过，继续找下一个
      }
    }
  }

  cache.set(name, resolved);
  return resolved;
}

module.exports = { resolveExe };
