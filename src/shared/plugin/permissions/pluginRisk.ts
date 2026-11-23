
export type RiskLevel = "none" | "caution" | "danger";

export interface RiskFinding {
  rule: string;
  reason: string;
}

export interface RiskReport {
  level: RiskLevel;
  findings: RiskFinding[];
}

interface RiskRule {
  rule: string;
  pattern: RegExp;
  reason: string;
  severity: Exclude<RiskLevel, "none">;
}

const RULES: RiskRule[] = [
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
      /\brm\s+-[a-zA-Z]{0,40}[rf][a-zA-Z]{0,40}\s|\brmdir\s+\/s|Remove-Item\b[^\n]{0,400}-Recurse|\bdel\s+\/[sS]\b/i,
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

function levelOf(findings: RiskFinding[]): RiskReport["level"] {
  if (findings.length === 0) return "none";
  if (findings.some((f) => DANGER_RULES.has(f.rule))) return "danger";
  return findings.length >= 2 ? "danger" : "caution";
}

const DANGER_RULES = new Set(
  RULES.filter((r) => r.severity === "danger").map((r) => r.rule)
);

export const RISK_LEVEL_TITLES: Record<RiskLevel, string> = {
  none: "未发现可疑操作",
  caution: "有些地方值得留意",
  danger: "这条命令有高危操作",
};

export const RISK_LEVEL_HINTS: Record<RiskLevel, string> = {
  none: "这条命令看起来只是在跑一个普通的程序。",
  caution: "下面的地方可能会做清单之外的事，运行前请确认。",
  danger:
    "下面的操作可能下载并执行远端代码、提权或删除文件。确认你信任这个应用的作者，否则不要运行。",
};
