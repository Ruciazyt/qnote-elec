/**
 * 清单命令的风险分析
 *
 * ## 为什么需要它
 *
 * 清单里的 `command` 是**经 shell 执行**的（见 appManager 的 `spawn(..., shell: true)`），
 * 意味着 `;` `&&` `|` `$(` 反引号这些 shell 元字符都会被解释。
 *
 * 而清单本身可能**不是本机用户写的** —— 从应用市场获取的清单是别人写的。
 * 本机用户自己填的命令，他知道那是什么；别人的命令，他没看过。
 *
 * 所以这里做的是「不可信输入」的处理：把命令里可疑的地方**指出来**，
 * 由用户判断，而不是替他决定能不能跑。
 *
 * ## 它不是安全边界
 *
 * 检测规则挡不住刻意伪装 —— `cmd` 换成别的可执行文件、脚本先下载再执行、
 * 编码过的载荷都能绕过关键词匹配。
 *
 * 真正的防线是**来源标记 + 运行前确认**：命令跑不跑由用户点确认框决定。
 * 这里的分析是给确认框提供信息，让用户看得懂，不是替用户做决定。
 */

/** 风险级别 */
export type RiskLevel = "none" | "caution" | "danger";

/** 一条风险发现 */
export interface RiskFinding {
  /** 规则标识 —— 程序内部用 */
  rule: string;
  /** 给用户看的中文说明 */
  reason: string;
}

/** 风险分析结果 */
export interface RiskReport {
  level: RiskLevel;
  findings: RiskFinding[];
}

/**
 * 一条规则
 *
 * 严重度分两档：
 * - `danger` —— 这条命令会做清单之外的事，或者有被利用的典型特征
 * - `caution` —— 值得用户多看一眼，但本身不一定是坏事
 */
interface RiskRule {
  rule: string;
  pattern: RegExp;
  reason: string;
  severity: Exclude<RiskLevel, "none">;
}

/**
 * 规则表
 *
 * 顺序不重要 —— 命中的规则全部列出，用户自己看。
 */
const RULES: RiskRule[] = [
  // ---- 结构性：命令会做不止一件事 ----
  {
    rule: "shell-separator",
    pattern: /[;&|]/,
    reason: "命令里有命令分隔符（; & |）—— 它会串起多条命令，不止一条",
    severity: "danger",
  },
  {
    rule: "shell-substitution",
    pattern: /\$\(|`/,
    reason: "命令里有命令替换（$( ) 或反引号）—— 实际执行的内容在运行时才决定",
    severity: "danger",
  },
  {
    rule: "shell-newline",
    pattern: /[\r\n]/,
    reason: "命令里有换行 —— 换行后面可能藏着另一条命令",
    severity: "danger",
  },

  // ---- 典型攻击特征 ----
  {
    rule: "download-pipe",
    pattern:
      /(curl|wget|fetch|Invoke-WebRequest|iwr)\b[^|;]*\|\s*(sudo\s+)?(sh|bash|zsh|powershell|pwsh|cmd|python|perl|ruby|node)\b/i,
    reason: "下载后直接管道执行 —— 远端内容会在你机器上直接跑",
    severity: "danger",
  },
  {
    rule: "remote-eval",
    pattern: /\b(iex|Invoke-Expression|eval)\b/i,
    reason: "执行动态拼接出来的代码",
    severity: "danger",
  },
  {
    rule: "base64-decode",
    pattern: /base64\s+(-d|--decode)|certutil\s+(-decode|-d)|FromBase64String/i,
    reason: "解码后执行 —— 真实内容被编码藏起来了",
    severity: "danger",
  },
  {
    rule: "destructive-delete",
    pattern:
      /\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*\s|\brmdir\s+\/s|Remove-Item\b[^\n]*-Recurse|\bdel\s+\/[sS]\b/i,
    reason: "递归删除 —— 可能删掉不该删的东西",
    severity: "danger",
  },
  {
    rule: "privilege-escalation",
    pattern: /\bsudo\b|\brunas\b|Start-Process\b[^\n]*-Verb\s+RunAs/i,
    reason: "提权执行",
    severity: "danger",
  },
  {
    rule: "encoded-powershell",
    pattern: /powershell(\.exe)?\b[^\n]*-(enc|encodedcommand)\b/i,
    reason: "编码后的 PowerShell 命令 —— 真实内容被藏起来了",
    severity: "danger",
  },

  // ---- 值得留意 ----
  {
    rule: "shell-redirect",
    pattern: /[<>]/,
    reason: "命令里有重定向（< >）—— 它会读写文件",
    severity: "caution",
  },
  {
    rule: "windows-shell",
    pattern: /\bcmd(\.exe)?\s+\/c\b|\bpowershell(\.exe)?\b|\bpwsh\b/i,
    reason: "调用了命令行解释器 —— 常见的藏命令手法",
    severity: "caution",
  },
  {
    rule: "credential-access",
    pattern:
      /\.ssh\b|\.aws\b|\.kube\b|AppData[\\/]Roaming[\\/][^\s]*[Tt]oken|cookies\.sqlite|\.git-credentials/i,
    reason: "碰到了凭据相关的路径",
    severity: "caution",
  },
  {
    rule: "permission-loosening",
    pattern: /\bchmod\s+(-[a-zA-Z]+\s+)?(777|a\+rwx)\b|icacls\b[^\n]*\/grant/i,
    reason: "放宽了文件权限",
    severity: "caution",
  },
  {
    rule: "package-install",
    pattern:
      /\bnpm\s+(install|i)\b[^\n]*(--force|-f)\b|\bpip\s+install\b[^\n]*--break-system-packages/i,
    reason: "强制安装依赖 —— 可能覆盖已有包",
    severity: "caution",
  },
];

/**
 * 分析一条命令的风险
 *
 * @param command 清单里的 command
 * @param args 清单里的 args（拼上一起看 —— 参数里也能塞 shell 语法）
 */
export function analyzeCommand(
  command: string,
  args: string[] = []
): RiskReport {
  const findings: RiskFinding[] = [];
  const text = [command, ...args].join(" ").trim();
  if (!text) return { level: "none", findings };

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      findings.push({ rule: rule.rule, reason: rule.reason });
    }
  }

  return { level: levelOf(findings), findings };
}

/**
 * 由发现推出级别
 *
 * 有一条 `danger` 级的发现就是 danger —— 结构性命令（`;` `&&` `|`）、
 * 下载即执行、提权、递归删除，这些都不是「留意一下」的量级。
 * 其余的按条数累加：一条是「留意一下」，两条以上就该拦一下。
 */
function levelOf(findings: RiskFinding[]): RiskReport["level"] {
  if (findings.length === 0) return "none";
  if (findings.some((f) => DANGER_RULES.has(f.rule))) return "danger";
  return findings.length >= 2 ? "danger" : "caution";
}

/**
 * 规则表里每条规则的严重度 —— 给 levelOf 用
 *
 * 单独放这里是因为 levelOf 需要知道「哪条发现是 danger 级的」，
 * 而 RiskFinding 只带 rule 标识，不带严重度。
 */
const DANGER_RULES = new Set(
  RULES.filter((r) => r.severity === "danger").map((r) => r.rule)
);

/** 级别对应的中文标题 —— 确认框上显示 */
export const RISK_LEVEL_TITLES: Record<RiskLevel, string> = {
  none: "未发现可疑操作",
  caution: "有些地方值得留意",
  danger: "这条命令有高危操作",
};

/** 级别对应的中文说明 —— 确认框上显示 */
export const RISK_LEVEL_HINTS: Record<RiskLevel, string> = {
  none: "这条命令看起来只是在跑一个普通的程序。",
  caution: "下面的地方可能会做清单之外的事，运行前请确认。",
  danger:
    "下面的操作可能下载并执行远端代码、提权或删除文件。确认你信任这个应用的作者，否则不要运行。",
};
