//! The Rust port of `src/shared/notes/`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

use crate::utf16;

const CREATABLE_NOTE_TYPES: [&str; 3] = ["excalidraw", "markdown", "html"];

const EXT_TO_TYPE: [(&str, &str); 13] = [
    (".excalidraw", "excalidraw"),
    (".md", "markdown"),
    (".markdown", "markdown"),
    (".html", "html"),
    (".htm", "html"),
    (".pdf", "pdf"),
    (".png", "image"),
    (".jpg", "image"),
    (".jpeg", "image"),
    (".gif", "image"),
    (".webp", "image"),
    (".bmp", "image"),
    (".svg", "image"),
];

/// (type, label, defaultExt), in the order of `NOTE_TYPES`.
const NOTE_TYPES: [(&str, &str, &str); 5] = [
    ("excalidraw", "绘图", ".excalidraw"),
    ("markdown", "文本", ".md"),
    ("html", "网页", ".html"),
    ("image", "图片", ".png"),
    ("pdf", "PDF", ".pdf"),
];

/// Port of `contentHash` (`src/shared/notes/noteHash.ts:2`).
pub fn content_hash(content: String) -> Result<String, String> {
    let mut h1: i32 = 0x811c9dc5u32 as i32;
    let mut h2: i32 = 0x01000193u32 as i32;

    for unit in content.encode_utf16() {
        let code = unit as i32;
        h1 ^= code;
        h1 = h1.wrapping_mul(0x01000193);
        h2 = (h2 ^ code).wrapping_mul(0x85ebca6bu32 as i32);
    }

    Ok(format!("{:08x}{:08x}", h1 as u32, h2 as u32))
}

/// Port of `isCreatableNoteType` (`src/shared/notes/noteTypes.ts:22`).
pub fn is_creatable_note_type(r#type: String) -> Result<bool, String> {
    Ok(CREATABLE_NOTE_TYPES.contains(&r#type.as_str()))
}

/// Port of `isFolderNode` (`src/shared/notes/noteTypes.ts:72`).
pub fn is_folder_node(node: serde_json::Value) -> Result<bool, String> {
    if node.is_null() {
        return Err("TypeError: Cannot read properties of null (reading 'kind')".to_string());
    }
    if crate::js::is_undefined(&node) {
        return Err("TypeError: Cannot read properties of undefined (reading 'kind')".to_string());
    }
    Ok(node.get("kind").and_then(|v| v.as_str()) == Some("folder"))
}

/// Port of `getExt` (`src/shared/notes/noteTypes.ts:81`).
pub fn get_ext(file_name: String) -> Result<String, String> {
    let units = utf16::units(&file_name);
    let Some(idx) = utf16::last_index_of(&units, &utf16::units(".")) else {
        return Ok(String::new());
    };
    if idx == 0 {
        return Ok(String::new());
    }
    Ok(js_to_lower_case(&utf16::slice(&units, idx, units.len())))
}

/// Port of `detectNoteType` (`src/shared/notes/noteTypes.ts:87`).
pub fn detect_note_type(file_name: String) -> Result<serde_json::Value, String> {
    let ext = get_ext(file_name)?;
    Ok(match EXT_TO_TYPE.iter().find(|(key, _)| *key == ext) {
        Some((_, note_type)) => serde_json::Value::String((*note_type).to_string()),
        None => serde_json::Value::Null,
    })
}

/// Port of `isNoteFile` (`src/shared/notes/noteTypes.ts:91`).
pub fn is_note_file(file_name: String) -> Result<bool, String> {
    Ok(!detect_note_type(file_name)?.is_null())
}

/// Port of `stripExt` (`src/shared/notes/noteTypes.ts:95`).
pub fn strip_ext(file_name: String) -> Result<String, String> {
    let ext = get_ext(file_name.clone())?;
    if ext.is_empty() {
        return Ok(file_name);
    }
    let units = utf16::units(&file_name);
    let end = units.len().saturating_sub(ext.encode_utf16().count());
    Ok(utf16::slice(&units, 0, end))
}

/// Port of `getNoteTypeMeta` (`src/shared/notes/noteTypes.ts:100`).
pub fn get_note_type_meta(r#type: String) -> Result<serde_json::Value, String> {
    let (note_type, label, default_ext) = note_type_meta(&r#type);
    Ok(serde_json::json!({
        "type": note_type,
        "label": label,
        "defaultExt": default_ext,
    }))
}

/// Port of `withDefaultExt` (`src/shared/notes/noteTypes.ts:104`).
pub fn with_default_ext(raw_name: String, r#type: String) -> Result<String, String> {
    let trimmed = js_trim(&raw_name);
    if trimmed.is_empty() {
        return Ok(trimmed);
    }
    if is_note_file(trimmed.clone())? {
        return Ok(trimmed);
    }
    let (_, _, default_ext) = note_type_meta(&r#type);
    Ok(format!("{trimmed}{default_ext}"))
}

/// The note type's meta, falling back to the first entry like `NOTE_TYPES.find(...) ?? NOTE_TYPES[0]`.
fn note_type_meta(r#type: &str) -> (&'static str, &'static str, &'static str) {
    NOTE_TYPES
        .iter()
        .find(|(note_type, _, _)| *note_type == r#type)
        .copied()
        .unwrap_or(NOTE_TYPES[0])
}

/// JS `String.prototype.trim`: WhiteSpace and LineTerminator, not Rust's White_Space set.
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

/// JS `String.prototype.toLowerCase`, final sigma included.
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
