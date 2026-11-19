//! The Rust port of src/main/core/ai/tools/web/.

#![forbid(unsafe_code)]

use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Value, json};

use crate::utf16;

/// JS \s 的字符集合。Rust 的 \s 是 Unicode White_Space：多了 U+0085、少了 U+FEFF。
const JS_SPACE: &str = r"[\t\n\x0B\x0C\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]";

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

fn regex(pattern: &str) -> Regex {
    Regex::new(&expand(pattern)).expect("pattern compiles")
}

static NUMERIC_ENTITY: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)&#(x[0-9a-f]+|[0-9]+);"));

static NAMED_ENTITY: LazyLock<Regex> = LazyLock::new(|| regex(r"&([a-zA-Z][a-zA-Z0-9]{0,30});"));

static SPACE_RUN: LazyLock<Regex> = LazyLock::new(|| regex(&format!(r"{s}+", s = JS_SPACE)));

static LINE_SPACE_RUN: LazyLock<Regex> = LazyLock::new(|| regex(r"[ \t\x{00a0}]+"));

static SCRIPT_BLOCK: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)<~s~cript[\s\S]*?</~s~cript>"));

static STYLE_BLOCK: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)<~s~tyle[\s\S]*?</~s~tyle>"));

static NOSCRIPT_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| regex(r"(?i)<no~s~cript[\s\S]*?</no~s~cript>"));

static TEMPLATE_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| regex(r"(?i)<template[\s\S]*?</template>"));

static COMMENT: LazyLock<Regex> = LazyLock::new(|| regex(r"<!--[\s\S]*?-->"));

static BLOCK_CLOSE: LazyLock<Regex> = LazyLock::new(|| {
    regex(&format!(
        r"(?i)</(p|div|~s~ection|article|li|ul|ol|tr|h[1-6]|blockquote|pre){s}*>",
        s = JS_SPACE
    ))
});

static BR: LazyLock<Regex> = LazyLock::new(|| regex(&format!(r"(?i)<br{s}*/?>", s = JS_SPACE)));

static TITLE: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)<title[^>]*>([\s\S]*?)</title>"));

static BING_BLOCK: LazyLock<Regex> = LazyLock::new(|| regex(r#"<li class="b_algo""#));

static BING_LINK: LazyLock<Regex> = LazyLock::new(|| {
    regex(&format!(
        r#"<h2[^>]*>{s}*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>"#,
        s = JS_SPACE
    ))
});

static P_TAG: LazyLock<Regex> = LazyLock::new(|| regex(r"<p[^>]*>([\s\S]*?)</p>"));

static BAIDU_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| regex(r#"<div[^>]*class="[^"]*c-container[^"]*""#));

static BAIDU_LINK: LazyLock<Regex> =
    LazyLock::new(|| regex(r#"<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)</a>"#));

static MU_ATTR: LazyLock<Regex> = LazyLock::new(|| regex(r#"(?-u:\b)mu="([^"]+)""#));

static H3: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)<h3[\s\S]*?</h3>"));

static HTTP_URL: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)^http~s~://"));

fn named_entity(name: &str) -> Option<&'static str> {
    Some(match name {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        "nbsp" => " ",
        "ensp" => " ",
        "emsp" => " ",
        "thinsp" => " ",
        "hellip" => "…",
        "middot" => "·",
        "mdash" => "—",
        "ndash" => "–",
        "laquo" => "«",
        "raquo" => "»",
        "ldquo" => "\"",
        "rdquo" => "\"",
        "lsquo" => "‘",
        "rsquo" => "’",
        "times" => "×",
        "divide" => "÷",
        "deg" => "°",
        "copy" => "©",
        "reg" => "®",
        "trade" => "™",
        "bull" => "•",
        "dagger" => "†",
        "permil" => "‰",
        "euro" => "€",
        "pound" => "£",
        "yen" => "¥",
        "cent" => "¢",
        "sect" => "§",
        "para" => "¶",
        "micro" => "µ",
        "frac12" => "½",
        "frac14" => "¼",
        "frac34" => "¾",
        "szlig" => "ß",
        "shy" => "",
        "zwnj" => "",
        "zwj" => "",
        "larr" => "←",
        "rarr" => "→",
        "uarr" => "↑",
        "darr" => "↓",
        "harr" => "↔",
        _ => return None,
    })
}

/// JS parseInt over a run of digits in the given radix.
fn parse_int_radix(digits: &str, radix: u32) -> f64 {
    let mut value = 0f64;
    for c in digits.chars() {
        let digit = c.to_digit(radix).unwrap_or(0);
        value = value * f64::from(radix) + f64::from(digit);
    }
    value
}

/// JS String.fromCodePoint behind the same guard the source uses.
fn from_code_point(code: f64) -> String {
    if !code.is_finite() || code < 0.0 || code > 0x10FFFF as f64 {
        return String::new();
    }
    char::from_u32(code as u32).map_or_else(String::new, |c| c.to_string())
}

fn decode_entities_str(input: &str) -> String {
    let stage = NUMERIC_ENTITY.replace_all(input, |caps: &regex::Captures<'_>| {
        let body = caps.get(1).map_or("", |m| m.as_str());
        let hex = body.starts_with('x') || body.starts_with('X');
        let code = parse_int_radix(
            if hex { &body[1..] } else { body },
            if hex { 16 } else { 10 },
        );
        from_code_point(code)
    });
    NAMED_ENTITY
        .replace_all(&stage, |caps: &regex::Captures<'_>| {
            let whole = caps.get(0).map_or("", |m| m.as_str());
            let body = caps.get(1).map_or("", |m| m.as_str());
            named_entity(body).map_or_else(|| whole.to_string(), str::to_string)
        })
        .into_owned()
}

fn strip_tags_str(html: &str) -> String {
    let mut kept: Vec<String> = Vec::new();
    let mut segments = html.split('<');
    kept.push(segments.next().unwrap_or_default().to_string());
    for segment in segments {
        match segment.find('>') {
            Some(end) => kept.push(segment[end + 1..].to_string()),
            None => kept.push(String::new()),
        }
    }
    kept.join(" ")
}

fn plain_text_str(html: &str) -> String {
    let decoded = decode_entities_str(&strip_tags_str(html));
    let collapsed = SPACE_RUN.replace_all(&decoded, " ");
    js_trim(&collapsed)
}

/// JS String.prototype.slice over UTF-16 code units.
fn js_slice(text: &str, end: usize) -> String {
    let units = utf16::units(text);
    utf16::slice(&units, 0, end)
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

/// Port of decodeEntities (src/main/core/ai/tools/web/searchEngine.ts:39).
pub fn decode_entities(input: String) -> Result<String, String> {
    Ok(decode_entities_str(&input))
}

/// Port of stripTags (src/main/core/ai/tools/web/searchEngine.ts:52).
pub fn strip_tags(html: String) -> Result<String, String> {
    Ok(strip_tags_str(&html))
}

/// Port of plainText (src/main/core/ai/tools/web/searchEngine.ts:63).
pub fn plain_text(html: String) -> Result<String, String> {
    Ok(plain_text_str(&html))
}

/// Port of htmlToText (src/main/core/ai/tools/web/searchEngine.ts:69).
pub fn html_to_text(html: String) -> Result<String, String> {
    let text = SCRIPT_BLOCK.replace_all(&html, " ");
    let text = STYLE_BLOCK.replace_all(&text, " ");
    let text = NOSCRIPT_BLOCK.replace_all(&text, " ");
    let text = TEMPLATE_BLOCK.replace_all(&text, " ");
    let text = COMMENT.replace_all(&text, " ");
    let text = BLOCK_CLOSE.replace_all(&text, "\n");
    let text = BR.replace_all(&text, "\n");

    let decoded = decode_entities_str(&strip_tags_str(&text));
    let lines: Vec<String> = decoded
        .split('\n')
        .map(|line| js_trim(&LINE_SPACE_RUN.replace_all(line, " ")))
        .collect();

    let mut out: Vec<String> = Vec::new();
    let mut pending_blank = false;
    for line in lines {
        if line.is_empty() {
            pending_blank = !out.is_empty();
            continue;
        }
        if pending_blank {
            out.push(String::new());
        }
        out.push(line);
        pending_blank = false;
    }
    Ok(out.join("\n"))
}

/// Port of extractTitle (src/main/core/ai/tools/web/searchEngine.ts:97).
pub fn extract_title(html: String) -> Result<String, String> {
    Ok(match TITLE.captures(&html) {
        Some(caps) => js_slice(&plain_text_str(caps.get(1).map_or("", |m| m.as_str())), 200),
        None => String::new(),
    })
}

/// Port of parseBingResults (src/main/core/ai/tools/web/searchEngine.ts:102).
pub fn parse_bing_results(html: String, limit: f64) -> Result<Vec<Value>, String> {
    let mut results: Vec<Value> = Vec::new();
    for block in BING_BLOCK.split(&html).skip(1) {
        if results.len() as f64 >= limit {
            break;
        }
        let Some(link) = BING_LINK.captures(block) else {
            continue;
        };
        let url = decode_entities_str(link.get(1).map_or("", |m| m.as_str()));
        if !HTTP_URL.is_match(&url) {
            continue;
        }
        let snippet = match P_TAG.captures(block) {
            Some(desc) => js_slice(&plain_text_str(desc.get(1).map_or("", |m| m.as_str())), 400),
            None => String::new(),
        };
        results.push(json!({
            "title": js_slice(&plain_text_str(link.get(2).map_or("", |m| m.as_str())), 160),
            "url": url,
            "snippet": snippet,
        }));
    }
    Ok(results)
}

/// Port of parseBaiduResults (src/main/core/ai/tools/web/searchEngine.ts:121).
pub fn parse_baidu_results(html: String, limit: f64) -> Result<Vec<Value>, String> {
    let mut results: Vec<Value> = Vec::new();
    for block in BAIDU_BLOCK.split(&html).skip(1) {
        if results.len() as f64 >= limit {
            break;
        }
        let Some(link) = BAIDU_LINK.captures(block) else {
            continue;
        };
        let raw = match MU_ATTR.captures(block) {
            Some(real) => real.get(1).map_or("", |m| m.as_str()),
            None => link.get(1).map_or("", |m| m.as_str()),
        };
        let url = decode_entities_str(raw);
        if !HTTP_URL.is_match(&url) {
            continue;
        }
        let body = H3.replace_all(block, " ");
        results.push(json!({
            "title": js_slice(&plain_text_str(link.get(2).map_or("", |m| m.as_str())), 160),
            "url": url,
            "snippet": js_slice(&plain_text_str(&body), 400),
        }));
    }
    Ok(results)
}

/// Port of buildSearchUrl (src/main/core/ai/tools/web/searchEngine.ts:141).
pub fn build_search_url(engine: String, query: String) -> Result<String, String> {
    let encoded = encode_uri_component(&query)?;
    Ok(if engine == "baidu" {
        format!("https://www.baidu.com/s?wd={encoded}&rn=10")
    } else {
        format!("https://www.bing.com/search?q={encoded}&count=10")
    })
}

/// JS encodeURIComponent: everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ) is percent-encoded.
fn encode_uri_component(text: &str) -> Result<String, String> {
    const KEEP: &str = "-_.!~*'()";
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii_alphanumeric() || KEEP.contains(c) {
            out.push(c);
            continue;
        }
        let mut buf = [0u8; 4];
        for byte in c.encode_utf8(&mut buf).as_bytes() {
            out.push('%');
            out.push_str(&format!("{byte:02X}"));
        }
    }
    Ok(out)
}
