//! The Rust port of src/shared/apps/.

#![forbid(unsafe_code)]

use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Value, json};

/// JS \s 的字符集合。Rust 的 \s 是 Unicode White_Space：多了 U+0085、少了 U+FEFF。
const JS_SPACE: &str = r"[\t\n\x0B\x0C\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]";

struct RiskRule {
    name: &'static str,
    reason: &'static str,
    pattern: Regex,
    danger: bool,
}

/// JS 的 i 标志只按 ASCII 折叠大小写，Rust 的 (?i) 走 Unicode 折叠：
/// ſ(U+017F) 会被当成 s、K(U+212A) 会被当成 k。占位符在编译前换成
/// 不参与折叠的等价写法。
/// JS 的 \b 只认 ASCII 词字符，Rust 的 \b 认 Unicode 词字符，所以用 (?-u:\b)。
fn expand(pattern: &str) -> String {
    pattern
        .replace("~s~", "(?-i:[sS])")
        .replace("~k~", "(?-i:[kK])")
        .replace("~az~", "(?-i:[a-zA-Z])")
}

fn rule(name: &'static str, pattern: &str, reason: &'static str, danger: bool) -> RiskRule {
    RiskRule {
        name,
        reason,
        pattern: Regex::new(&expand(pattern)).expect("risk rule compiles"),
        danger,
    }
}

static RULES: LazyLock<Vec<RiskRule>> = LazyLock::new(|| {
    let s = JS_SPACE;
    vec![
        rule(
            "shell-separator",
            r"[;&|]",
            "命令里有命令分隔符（; & |）—— 它会串起多条命令，不止一条",
            true,
        ),
        rule(
            "shell-substitution",
            r"\$\(|\x60",
            "命令里有命令替换（$( ) 或反引号）—— 实际执行的内容在运行时才决定",
            true,
        ),
        rule(
            "shell-newline",
            r"[\r\n]",
            "命令里有换行 —— 换行后面可能藏着另一条命令",
            true,
        ),
        rule(
            "download-pipe",
            &format!(
                r"(?i)(curl|wget|fetch|Invoke-WebRequest|iwr)(?-u:\b)[^|;]*\|{s}*((~s~udo){s}*)?(~s~h|ba~s~h|z~s~h|power~s~hell|pw~s~h|cmd|python|perl|ruby|node)(?-u:\b)"
            ),
            "下载后直接管道执行 —— 远端内容会在你机器上直接跑",
            true,
        ),
        rule(
            "remote-eval",
            r"(?i)(?-u:\b)(iex|Invoke-Expre~s~~s~ion|eval)(?-u:\b)",
            "执行动态拼接出来的代码",
            true,
        ),
        rule(
            "base64-decode",
            &format!(r"(?i)base64{s}+(-d|--decode)|certutil{s}+(-decode|-d)|FromBase64~s~tring"),
            "解码后执行 —— 真实内容被编码藏起来了",
            true,
        ),
        rule(
            "destructive-delete",
            &format!(
                r"(?i)(?-u:\b)rm{s}+-(~az~){{0,40}}[rf](~az~){{0,40}}{s}|(?-u:\b)rmdir{s}+\/s|Remove-Item(?-u:\b)[^\n]{{0,400}}-Recurse|(?-u:\b)del{s}+\/(?-i:[sS])(?-u:\b)"
            ),
            "递归删除 —— 可能删掉不该删的东西",
            true,
        ),
        rule(
            "privilege-escalation",
            &format!(
                r"(?i)(?-u:\b)~s~udo|(?-u:\b)runa~s~|Start-Proce~s~~s~(?-u:\b)[^\n]*-Verb{s}+RunA~s~"
            ),
            "提权执行",
            true,
        ),
        rule(
            "encoded-powershell",
            r"(?i)power~s~hell(\.exe)?(?-u:\b)[^\n]*-(enc|encodedcommand)(?-u:\b)",
            "编码后的 PowerShell 命令 —— 真实内容被藏起来了",
            true,
        ),
        rule(
            "shell-redirect",
            r"[<>]",
            "命令里有重定向（< >）—— 它会读写文件",
            false,
        ),
        rule(
            "windows-shell",
            &format!(
                r"(?i)(?-u:\b)cmd(\.exe)?{s}+\/c(?-u:\b)|(?-u:\b)power~s~hell(\.exe)?(?-u:\b)|(?-u:\b)pw~s~h(?-u:\b)"
            ),
            "调用了命令行解释器 —— 常见的藏命令手法",
            false,
        ),
        rule(
            "credential-access",
            &format!(
                r"(?i)\.~s~~s~h(?-u:\b)|\.aws(?-u:\b)|\.~k~ube(?-u:\b)|AppData[\\/]Roaming[\\/][^{s}]*to~k~en|cookie~s~\.sqlite|\.git-credentials"
            ),
            "碰到了凭据相关的路径",
            false,
        ),
        rule(
            "permission-loosening",
            &format!(
                r"(?i)(?-u:\b)chmod{s}+(-(~az~)+{s}+)?(777|a\+rwx)(?-u:\b)|icacl~s~(?-u:\b)[^\n]*\/grant"
            ),
            "放宽了文件权限",
            false,
        ),
        rule(
            "package-install",
            &format!(
                r"(?i)(?-u:\b)npm{s}+(in~s~tall|i)(?-u:\b)[^\n]*(--force|-f)(?-u:\b)|(?-u:\b)pip{s}+in~s~tall(?-u:\b)[^\n]*--break-system-package~s~"
            ),
            "强制安装依赖 —— 可能覆盖已有包",
            false,
        ),
    ]
});

/// Port of analyzeCommand (src/shared/apps/appRisk.ts:114).
pub fn analyze_command(command: String, args: Option<Vec<String>>) -> Result<Value, String> {
    let mut parts: Vec<&str> = Vec::with_capacity(1 + args.as_ref().map_or(0, Vec::len));
    parts.push(command.as_str());
    if let Some(list) = args.as_ref() {
        for item in list {
            parts.push(item.as_str());
        }
    }
    let text = js_trim(&parts.join(" "));

    let mut findings: Vec<Value> = Vec::new();
    if !text.is_empty() {
        for rule in RULES.iter() {
            if rule.pattern.is_match(&text) {
                findings.push(json!({ "rule": rule.name, "reason": rule.reason }));
            }
        }
    }

    let level = level_of(&findings);
    Ok(json!({ "level": level, "findings": findings }))
}

fn level_of(findings: &[Value]) -> &'static str {
    if findings.is_empty() {
        return "none";
    }
    let has_danger = findings.iter().any(|finding| {
        finding
            .get("rule")
            .and_then(Value::as_str)
            .map(|name| RULES.iter().any(|rule| rule.danger && rule.name == name))
            .unwrap_or(false)
    });
    if has_danger {
        return "danger";
    }
    if findings.len() >= 2 {
        return "danger";
    }
    "caution"
}

/// JS String.prototype.trim: WhiteSpace and LineTerminator, not Rust's White_Space set.
fn js_trim(s: &str) -> String {
    s.trim_matches(is_js_whitespace).to_string()
}

fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}'
            | '\u{A}'
            | '\u{B}'
            | '\u{C}'
            | '\u{D}'
            | '\u{20}'
            | '\u{A0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}
