//! The Rust port of src/shared/ai/.

#![forbid(unsafe_code)]

use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Map, Value, json};

use crate::js;
use crate::utf16;

const AI_IMAGE_ALLOWED_MIMES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const AI_IMAGE_MAX_COUNT: usize = 4;
const AI_IMAGE_MAX_DATA_CHARS: usize = 4_500_000;
const SESSION_PREVIEW_MAX: f64 = 80.0;
const TRUNCATED_SUFFIX: &str = "…（结果过长已截断）";

/// JS \s 的字符集合。Rust 的 \s 是 Unicode White_Space：多了 U+0085、少了 U+FEFF。
const JS_SPACE: &str = r"[\t\n\x0B\x0C\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]";

static DATA_URL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^data:([A-Za-z0-9_]+/[A-Za-z0-9_]+);base64,([A-Za-z0-9+/]+=*)$").unwrap()
});

static BASE64: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9+/]+=*$").unwrap());

static SPACE_RUN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r"{s}+", s = JS_SPACE)).unwrap());

static THINK_PAIR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<think>[\s\S]*?</think>").unwrap());

static THINK_TAIL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<think>[\s\S]*$").unwrap());

static THINK_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)</?think>").unwrap());

static LINE_SPLIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\r?\n").unwrap());

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

/// JS String.prototype.toLowerCase, final sigma included.
fn js_to_lower_case(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    for (i, &c) in chars.iter().enumerate() {
        if c == '\u{3A3}' {
            let prev_cased = i > 0 && is_cased(chars[i - 1]);
            let next_cased = i + 1 < chars.len() && is_cased(chars[i + 1]);
            out.push(if prev_cased && !next_cased {
                '\u{3C2}'
            } else {
                '\u{3C3}'
            });
            continue;
        }
        for lower in c.to_lowercase() {
            out.push(lower);
        }
    }
    out
}

fn is_cased(c: char) -> bool {
    c.is_uppercase() || c.is_lowercase()
}

/// JS String.prototype.slice over UTF-16 code units, negative bounds included.
fn js_slice_units(text: &str, start: f64, end: f64) -> Vec<u16> {
    let units = utf16::units(text);
    let len = units.len() as i64;
    let to_int = |value: f64| -> i64 {
        if value.is_nan() {
            0
        } else {
            value.trunc() as i64
        }
    };
    let mut s = to_int(start);
    let mut e = to_int(end);
    if s < 0 {
        s = (len + s).max(0);
    }
    if e < 0 {
        e = (len + e).max(0);
    }
    e = e.min(len);
    if s < 0 || e <= s {
        return Vec::new();
    }
    units[s as usize..e as usize].to_vec()
}

/// The UTF-16 length JS String.prototype.length reports.
fn js_length(text: &str) -> usize {
    utf16::units(text).len()
}

/// The content of a JSON string as JSON.stringify would write it, lone surrogates included.
fn escape_json_content(units: &[u16]) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < units.len() {
        let unit = units[i];
        if (0xD800..0xDC00).contains(&unit) {
            if i + 1 < units.len() && (0xDC00..0xE000).contains(&units[i + 1]) {
                let point = 0x10000
                    + ((u32::from(unit) - 0xD800) << 10)
                    + (u32::from(units[i + 1]) - 0xDC00);
                out.push(char::from_u32(point).unwrap_or('\u{FFFD}'));
                i += 2;
                continue;
            }
            out.push_str(&format!("\\u{unit:04x}"));
            i += 1;
            continue;
        }
        if (0xDC00..0xE000).contains(&unit) {
            out.push_str(&format!("\\u{unit:04x}"));
            i += 1;
            continue;
        }
        let c = char::from_u32(u32::from(unit)).unwrap_or('\u{FFFD}');
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
        i += 1;
    }
    out
}

/// JS truthiness of a value that crossed the JSON channel.
fn truthy(value: &Value) -> bool {
    if js::is_undefined(value) {
        return false;
    }
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// JS String(value) for the values that reach a template literal.
fn js_to_string(value: &Value) -> String {
    if js::is_undefined(value) {
        return "undefined".to_string();
    }
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if item.is_null() || js::is_undefined(item) {
                    String::new()
                } else {
                    js_to_string(item)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

/// The elements of a value JS would call .map on, or the error JS would throw.
fn js_map_items(value: &Value, name: &str) -> Result<Vec<Value>, String> {
    match value {
        Value::Array(items) => Ok(items.clone()),
        _ => Err(format!("TypeError: {name}.map is not a function")),
    }
}

/// Whether JS would read .length === 0 off the value.
fn js_length_is_zero(value: &Value) -> bool {
    value.get("length").and_then(Value::as_f64) == Some(0.0)
}

fn null_or_undefined_message(value: &Value, property: &str) -> String {
    let kind = if value.is_null() { "null" } else { "undefined" };
    format!("TypeError: Cannot read properties of {kind} (reading '{property}')")
}

/// Port of parseBlocks (src/shared/ai/aiBlocks.ts:109).
pub fn parse_blocks(raw: Value) -> Result<Vec<Value>, String> {
    let Value::String(text) = raw else {
        return Ok(Vec::new());
    };
    if text.is_empty() {
        return Ok(Vec::new());
    }
    let Ok(parsed) = serde_json::from_str::<Value>(&text) else {
        return Ok(Vec::new());
    };
    let Value::Array(items) = parsed else {
        return Ok(Vec::new());
    };
    Ok(items.into_iter().filter(keep_block).collect())
}

fn keep_block(block: &Value) -> bool {
    let kind = block.get("kind").and_then(Value::as_str);
    if kind == Some("thinking") || kind == Some("text") {
        return block.get("text").is_some_and(Value::is_string);
    }
    if kind == Some("tool") {
        return block
            .get("call")
            .and_then(|call| call.get("name"))
            .is_some_and(truthy);
    }
    false
}

/// Port of serializeBlocks (src/shared/ai/aiBlocks.ts:125).
pub fn serialize_blocks(blocks: Value, max_result_len: Option<f64>) -> Result<String, String> {
    if !truthy(&blocks) {
        return Ok(String::new());
    }
    let items = match &blocks {
        Value::Array(items) => {
            if items.is_empty() {
                return Ok(String::new());
            }
            items.clone()
        }
        _ => {
            if js_length_is_zero(&blocks) {
                return Ok(String::new());
            }
            return Err("TypeError: blocks.map is not a function".to_string());
        }
    };

    let max = max_result_len.unwrap_or(2048.0);
    let mut lone: Vec<(String, String)> = Vec::new();
    let mut mapped: Vec<Value> = Vec::with_capacity(items.len());
    for block in items {
        if block.is_null() || js::is_undefined(&block) {
            return Err(null_or_undefined_message(&block, "kind"));
        }
        if block.get("kind").and_then(Value::as_str) != Some("tool") {
            mapped.push(block);
            continue;
        }
        let mut outer = match &block {
            Value::Object(map) => map.clone(),
            _ => Map::new(),
        };
        let mut call = match outer.get("call") {
            Some(Value::Object(map)) => map.clone(),
            _ => Map::new(),
        };
        if let Some(Value::String(result)) = call.get("result").cloned()
            && js_length(&result) as f64 > max
        {
            let mut units = js_slice_units(&result, 0.0, max);
            units.extend(utf16::units(TRUNCATED_SUFFIX));
            match String::from_utf16(&units) {
                Ok(text) => {
                    call.insert("result".to_string(), Value::String(text));
                }
                Err(_) => {
                    let marker = format!("\u{1}qnote-lone-{}\u{1}", lone.len());
                    lone.push((marker.clone(), escape_json_content(&units)));
                    call.insert("result".to_string(), Value::String(marker));
                }
            }
        }
        outer.insert("call".to_string(), Value::Object(call));
        mapped.push(Value::Object(outer));
    }

    let mut text = serde_json::to_string(&mapped).map_err(|e| e.to_string())?;
    for (marker, escaped) in lone {
        let quoted = serde_json::to_string(&marker).map_err(|e| e.to_string())?;
        let needle = quoted.trim_matches('"').to_string();
        text = text.replace(&needle, &escaped);
    }
    Ok(text)
}

/// Port of aiImageDataUrl (src/shared/ai/aiImages.ts:23).
pub fn ai_image_data_url(image: Value) -> Result<String, String> {
    if image.is_null() || js::is_undefined(&image) {
        return Err(null_or_undefined_message(&image, "mime"));
    }
    let mime = image
        .get("mime")
        .map(js_to_string)
        .unwrap_or_else(|| "undefined".to_string());
    let data = image
        .get("data")
        .map(js_to_string)
        .unwrap_or_else(|| "undefined".to_string());
    Ok(format!("data:{mime};base64,{data}"))
}

/// Port of parseAiImageDataUrl (src/shared/ai/aiImages.ts:27).
pub fn parse_ai_image_data_url(data_url: String) -> Result<Value, String> {
    let trimmed = js_trim(&data_url);
    Ok(match DATA_URL.captures(&trimmed) {
        Some(caps) => {
            let mime = js_to_lower_case(caps.get(1).map_or("", |m| m.as_str()));
            let data = caps.get(2).map_or("", |m| m.as_str()).to_string();
            json!({ "mime": mime, "data": data })
        }
        None => Value::Null,
    })
}

/// Port of normalizeAiImages (src/shared/ai/aiImages.ts:33).
pub fn normalize_ai_images(raw: Value) -> Result<Vec<Value>, String> {
    let Value::Array(items) = raw else {
        return Ok(Vec::new());
    };
    let mut result: Vec<Value> = Vec::new();
    for item in items {
        if result.len() >= AI_IMAGE_MAX_COUNT {
            break;
        }
        if !item.is_object() {
            continue;
        }
        let mime = string_field(&item, "mime")
            .map(|value| js_to_lower_case(&js_trim(&value)))
            .unwrap_or_default();
        let data = string_field(&item, "data")
            .map(|value| js_trim(&value))
            .unwrap_or_default();
        if mime.is_empty() || data.is_empty() {
            continue;
        }
        if !AI_IMAGE_ALLOWED_MIMES.contains(&mime.as_str()) {
            continue;
        }
        if !BASE64.is_match(&data) {
            continue;
        }
        if js_length(&data) > AI_IMAGE_MAX_DATA_CHARS {
            continue;
        }
        let name = match string_field(&item, "name") {
            Some(name) => Value::String(name),
            None => js::undefined(),
        };
        result.push(json!({ "mime": mime, "data": data, "name": name }));
    }
    Ok(result)
}

/// Port of serializeAiImages (src/shared/ai/aiImages.ts:59).
pub fn serialize_ai_images(images: Value) -> Result<String, String> {
    if !truthy(&images) {
        return Ok(String::new());
    }
    let items = match &images {
        Value::Array(items) => {
            if items.is_empty() {
                return Ok(String::new());
            }
            items.clone()
        }
        _ => {
            if js_length_is_zero(&images) {
                return Ok(String::new());
            }
            return Err("TypeError: images.map is not a function".to_string());
        }
    };
    let mapped: Vec<Value> = items
        .into_iter()
        .map(|image| {
            let mut map = Map::new();
            if let Some(mime) = image.get("mime")
                && !js::is_undefined(mime)
            {
                map.insert("mime".to_string(), mime.clone());
            }
            if let Some(data) = image.get("data")
                && !js::is_undefined(data)
            {
                map.insert("data".to_string(), data.clone());
            }
            if let Some(name) = image.get("name")
                && truthy(name)
            {
                map.insert("name".to_string(), name.clone());
            }
            Value::Object(map)
        })
        .collect();
    serde_json::to_string(&mapped).map_err(|e| e.to_string())
}

/// Port of parseAiImages (src/shared/ai/aiImages.ts:70).
pub fn parse_ai_images(raw: Value) -> Result<Vec<Value>, String> {
    let Value::String(text) = raw else {
        return Ok(Vec::new());
    };
    if text.is_empty() {
        return Ok(Vec::new());
    }
    let Ok(parsed) = serde_json::from_str::<Value>(&text) else {
        return Ok(Vec::new());
    };
    normalize_ai_images(parsed)
}

/// Port of aiImageContentBlocks (src/shared/ai/aiImages.ts:81).
pub fn ai_image_content_blocks(images: Value) -> Result<Vec<Value>, String> {
    let items = js_map_items(&images, "images")?;
    Ok(items
        .into_iter()
        .map(|image| {
            let url = ai_image_data_url(image).unwrap_or_default();
            json!({ "type": "image_url", "image_url": { "url": url } })
        })
        .collect())
}

/// Port of buildUserContent (src/shared/ai/aiImages.ts:88).
pub fn build_user_content(text: String, images: Value) -> Result<Value, String> {
    let trimmed = js_trim(&text);
    if !truthy(&images) {
        return Ok(Value::String(trimmed));
    }
    let items = match &images {
        Value::Array(items) => items.clone(),
        _ => {
            if js_length_is_zero(&images) {
                return Ok(Value::String(trimmed));
            }
            return Err("TypeError: images.map is not a function".to_string());
        }
    };
    if items.is_empty() {
        return Ok(Value::String(trimmed));
    }
    let mut blocks = ai_image_content_blocks(Value::Array(items))?;
    if !trimmed.is_empty() {
        blocks.push(json!({ "type": "text", "text": trimmed }));
    }
    Ok(Value::Array(blocks))
}

/// Port of aiContentToText (src/shared/ai/aiImages.ts:100).
pub fn ai_content_to_text(content: Value) -> Result<String, String> {
    if let Value::String(text) = &content {
        return Ok(text.clone());
    }
    let Value::Array(items) = content else {
        return Ok(String::new());
    };
    let mut parts: Vec<String> = Vec::new();
    for block in items {
        if let Value::String(text) = &block {
            parts.push(text.clone());
            continue;
        }
        if !block.is_object() {
            continue;
        }
        if block.get("type").and_then(Value::as_str) == Some("text")
            && let Some(text) = block.get("text").and_then(Value::as_str)
        {
            parts.push(text.to_string());
        }
    }
    Ok(parts.join("\n"))
}

/// Port of buildSessionPreview (src/shared/ai/aiSessionPreview.ts:4).
pub fn build_session_preview(text: Option<String>, max: Option<f64>) -> Result<Value, String> {
    let source = text.unwrap_or_default();
    let cleaned = THINK_PAIR.replace_all(&source, " ");
    let cleaned = THINK_TAIL.replace_all(&cleaned, " ");
    let cleaned = THINK_TAG.replace_all(&cleaned, " ");
    let cleaned = SPACE_RUN.replace_all(&cleaned, " ");
    let cleaned = js_trim(&cleaned);
    if cleaned.is_empty() {
        return Ok(Value::String(String::new()));
    }
    let max = max.unwrap_or(SESSION_PREVIEW_MAX);
    let units = utf16::units(&cleaned);
    if units.len() as f64 > max {
        let mut sliced = js_slice_units(&cleaned, 0.0, max);
        sliced.push(0x2026);
        return Ok(js::utf16_string(&sliced));
    }
    Ok(js::utf16_string(&units))
}

/// Port of parseKeyValueLines (src/shared/ai/mcp.ts:74).
pub fn parse_key_value_lines(text: String) -> Result<Value, String> {
    let mut out: Map<String, Value> = Map::new();
    for line in LINE_SPLIT.split(&text) {
        let trimmed = js_trim(line);
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some(idx) = trimmed.find('=') else {
            continue;
        };
        if idx == 0 {
            continue;
        }
        let key = js_trim(&trimmed[..idx]);
        let value = js_trim(&trimmed[idx + 1..]);
        if !key.is_empty() {
            out.insert(key, Value::String(value));
        }
    }
    Ok(Value::Object(out))
}

/// Port of parseArgsLines (src/shared/ai/mcp.ts:88).
pub fn parse_args_lines(text: String) -> Result<Vec<String>, String> {
    Ok(LINE_SPLIT
        .split(&text)
        .map(js_trim)
        .filter(|line| !line.is_empty())
        .collect())
}
