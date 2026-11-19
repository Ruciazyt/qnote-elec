//! JS bindings for `src/shared/ai/`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use napi_derive::napi;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".into())
}

#[allow(dead_code)]
fn run<T>(f: impl FnOnce() -> Result<T, String>) -> napi::Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(result) => result.map_err(napi::Error::from_reason),
        Err(payload) => Err(napi::Error::from_reason(format!(
            "Rust panic: {}",
            panic_message(&*payload)
        ))),
    }
}

/// `parseBlocks`.
#[napi(js_name = "parseBlocks")]
pub fn parse_blocks(raw: String) -> napi::Result<String> {
    run(move || {
        let raw = crate::js::from_json(&raw)?;
        let out = port::parse_blocks(raw)?;
        crate::js::to_json(&out)
    })
}

/// `serializeBlocks`.
#[napi(js_name = "serializeBlocks")]
pub fn serialize_blocks(blocks: String, max_result_len: Option<f64>) -> napi::Result<String> {
    run(move || {
        let blocks = crate::js::from_json(&blocks)?;
        let out = port::serialize_blocks(blocks, max_result_len)?;
        Ok(out)
    })
}

/// `aiImageDataUrl`.
#[napi(js_name = "aiImageDataUrl")]
pub fn ai_image_data_url(image: String) -> napi::Result<String> {
    run(move || {
        let image = crate::js::from_json(&image)?;
        let out = port::ai_image_data_url(image)?;
        Ok(out)
    })
}

/// `parseAiImageDataUrl`.
#[napi(js_name = "parseAiImageDataUrl")]
pub fn parse_ai_image_data_url(data_url: String) -> napi::Result<String> {
    run(move || {
        let out = port::parse_ai_image_data_url(data_url)?;
        crate::js::to_json(&out)
    })
}

/// `normalizeAiImages`.
#[napi(js_name = "normalizeAiImages")]
pub fn normalize_ai_images(raw: String) -> napi::Result<String> {
    run(move || {
        let raw = crate::js::from_json(&raw)?;
        let out = port::normalize_ai_images(raw)?;
        crate::js::to_json(&out)
    })
}

/// `serializeAiImages`.
#[napi(js_name = "serializeAiImages")]
pub fn serialize_ai_images(images: String) -> napi::Result<String> {
    run(move || {
        let images = crate::js::from_json(&images)?;
        let out = port::serialize_ai_images(images)?;
        Ok(out)
    })
}

/// `parseAiImages`.
#[napi(js_name = "parseAiImages")]
pub fn parse_ai_images(raw: String) -> napi::Result<String> {
    run(move || {
        let raw = crate::js::from_json(&raw)?;
        let out = port::parse_ai_images(raw)?;
        crate::js::to_json(&out)
    })
}

/// `aiImageContentBlocks`.
#[napi(js_name = "aiImageContentBlocks")]
pub fn ai_image_content_blocks(images: String) -> napi::Result<String> {
    run(move || {
        let images = crate::js::from_json(&images)?;
        let out = port::ai_image_content_blocks(images)?;
        crate::js::to_json(&out)
    })
}

/// `buildUserContent`.
#[napi(js_name = "buildUserContent")]
pub fn build_user_content(text: String, images: String) -> napi::Result<String> {
    run(move || {
        let images = crate::js::from_json(&images)?;
        let out = port::build_user_content(text, images)?;
        crate::js::to_json(&out)
    })
}

/// `aiContentToText`.
#[napi(js_name = "aiContentToText")]
pub fn ai_content_to_text(content: String) -> napi::Result<String> {
    run(move || {
        let content = crate::js::from_json(&content)?;
        let out = port::ai_content_to_text(content)?;
        Ok(out)
    })
}

/// `buildSessionPreview`.
#[napi(js_name = "buildSessionPreview")]
pub fn build_session_preview(text: Option<String>, max: Option<f64>) -> napi::Result<String> {
    run(move || {
        let out = port::build_session_preview(text, max)?;
        crate::js::to_json(&out)
    })
}

/// `parseKeyValueLines`.
#[napi(js_name = "parseKeyValueLines")]
pub fn parse_key_value_lines(text: String) -> napi::Result<String> {
    run(move || {
        let out = port::parse_key_value_lines(text)?;
        crate::js::to_json(&out)
    })
}

/// `parseArgsLines`.
#[napi(js_name = "parseArgsLines")]
pub fn parse_args_lines(text: String) -> napi::Result<Vec<String>> {
    run(move || {
        let out = port::parse_args_lines(text)?;
        Ok(out)
    })
}

// ---- the binary wire ------------------------------------------------------------------------

thread_local! {
    static WIRE: std::cell::RefCell<Option<(napi::bindgen_prelude::Uint8Array, napi::bindgen_prelude::Uint8Array)>> =
        const { std::cell::RefCell::new(None) };
    static PENDING: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Registers the argument and result buffers `index.cjs` writes to and reads from.
#[napi(js_name = "rustAnythingWireInit")]
pub fn rust_anything_wire_init(
    input: napi::bindgen_prelude::Uint8Array,
    output: napi::bindgen_prelude::Uint8Array,
) {
    WIRE.with(|w| *w.borrow_mut() = Some((input, output)));
}

/// Copies a result that did not fit into the (now larger) result buffer.
#[napi(js_name = "rustAnythingWireFlush")]
pub fn rust_anything_wire_flush() -> f64 {
    let bytes = PENDING.with(|p| std::mem::take(&mut *p.borrow_mut()));
    WIRE.with(|w| {
        let mut w = w.borrow_mut();
        let Some((_, output)) = w.as_mut() else {
            return -1.0;
        };
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = bytes.len().min(out.len());
        out[..n].copy_from_slice(&bytes[..n]);
        n as f64
    })
}

/// Reads `len` argument bytes, runs `f`, and writes its result; a negative return is the size
/// of a result that did not fit, kept for `rustAnythingWireFlush`.
fn wire_io(
    len: u32,
    f: impl FnOnce(&mut wire::Reader, &mut wire::Writer) -> Result<(), String>,
) -> napi::Result<f64> {
    WIRE.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some((input, output)) = guard.as_mut() else {
            return Err(napi::Error::from_reason(
                "rust-anything: the wire buffers are not registered",
            ));
        };
        let len = (len as usize).min(input.len());
        let mut w = wire::Writer::default();
        match run(|| f(&mut wire::Reader::new(&input[..len]), &mut w)) {
            // A result of another shape than the TS type: JS runs the call through JSON.
            Err(e) if e.reason.starts_with(wire::MISMATCH) => return Ok(f64::NAN),
            other => other?,
        }
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = w.0.len();
        if n > out.len() {
            PENDING.with(|p| *p.borrow_mut() = w.0);
            return Ok(-(n as f64));
        }
        out[..n].copy_from_slice(&w.0);
        Ok(n as f64)
    })
}

static S_PARSE_BLOCKS_0: wire::Schema = wire::Schema::Dyn;
static S_PARSE_BLOCKS_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Dyn);

/// `parseBlocks` over the binary wire.
#[napi(js_name = "parseBlocksWire")]
pub fn parse_blocks_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let raw: Value = wire::read_value(r, &S_PARSE_BLOCKS_0)?;
        let out = &port::parse_blocks(raw)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_PARSE_BLOCKS_OUT.inner())?;
        }
        Ok(())
    })
}

static S_SERIALIZE_BLOCKS_0: wire::Schema = wire::Schema::List(&wire::Schema::Dyn);

/// `serializeBlocks` over the binary wire.
#[napi(js_name = "serializeBlocksWire")]
pub fn serialize_blocks_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let blocks: Value = wire::read_value(r, &S_SERIALIZE_BLOCKS_0)?;
        let max_result_len: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::serialize_blocks(blocks, max_result_len)?;
        w.string16(out);
        Ok(())
    })
}

static S_AI_IMAGE_DATA_URL_0: wire::Schema = wire::Schema::Obj(&[
    ("mime", wire::Schema::Str16),
    ("data", wire::Schema::Str16),
    ("name", wire::Schema::OptJs(&wire::Schema::Str16)),
]);

/// `aiImageDataUrl` over the binary wire.
#[napi(js_name = "aiImageDataUrlWire")]
pub fn ai_image_data_url_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let image: Value = wire::read_value(r, &S_AI_IMAGE_DATA_URL_0)?;
        let out = &port::ai_image_data_url(image)?;
        w.string16(out);
        Ok(())
    })
}

static S_PARSE_AI_IMAGE_DATA_URL_OUT: wire::Schema = wire::Schema::OptJs(&wire::Schema::Obj(&[
    ("mime", wire::Schema::Str16),
    ("data", wire::Schema::Str16),
    ("name", wire::Schema::OptJs(&wire::Schema::Str16)),
]));

/// `parseAiImageDataUrl` over the binary wire.
#[napi(js_name = "parseAiImageDataUrlWire")]
pub fn parse_ai_image_data_url_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let data_url: String = r.string16()?;
        let out = &port::parse_ai_image_data_url(data_url)?;
        wire::write_value(w, out, &S_PARSE_AI_IMAGE_DATA_URL_OUT)?;
        Ok(())
    })
}

static S_NORMALIZE_AI_IMAGES_0: wire::Schema = wire::Schema::Dyn;
static S_NORMALIZE_AI_IMAGES_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("mime", wire::Schema::Str16),
    ("data", wire::Schema::Str16),
    ("name", wire::Schema::OptJs(&wire::Schema::Str16)),
]));

/// `normalizeAiImages` over the binary wire.
#[napi(js_name = "normalizeAiImagesWire")]
pub fn normalize_ai_images_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let raw: Value = wire::read_value(r, &S_NORMALIZE_AI_IMAGES_0)?;
        let out = &port::normalize_ai_images(raw)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_NORMALIZE_AI_IMAGES_OUT.inner())?;
        }
        Ok(())
    })
}

static S_SERIALIZE_AI_IMAGES_0: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("mime", wire::Schema::Str16),
    ("data", wire::Schema::Str16),
    ("name", wire::Schema::OptJs(&wire::Schema::Str16)),
]));

/// `serializeAiImages` over the binary wire.
#[napi(js_name = "serializeAiImagesWire")]
pub fn serialize_ai_images_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let images: Value = wire::read_value(r, &S_SERIALIZE_AI_IMAGES_0)?;
        let out = &port::serialize_ai_images(images)?;
        w.string16(out);
        Ok(())
    })
}

static S_PARSE_AI_IMAGES_0: wire::Schema = wire::Schema::Dyn;
static S_PARSE_AI_IMAGES_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("mime", wire::Schema::Str16),
    ("data", wire::Schema::Str16),
    ("name", wire::Schema::OptJs(&wire::Schema::Str16)),
]));

/// `parseAiImages` over the binary wire.
#[napi(js_name = "parseAiImagesWire")]
pub fn parse_ai_images_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let raw: Value = wire::read_value(r, &S_PARSE_AI_IMAGES_0)?;
        let out = &port::parse_ai_images(raw)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_PARSE_AI_IMAGES_OUT.inner())?;
        }
        Ok(())
    })
}

static S_AI_IMAGE_CONTENT_BLOCKS_0: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("mime", wire::Schema::Str16),
    ("data", wire::Schema::Str16),
    ("name", wire::Schema::OptJs(&wire::Schema::Str16)),
]));
static S_AI_IMAGE_CONTENT_BLOCKS_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Dyn);

/// `aiImageContentBlocks` over the binary wire.
#[napi(js_name = "aiImageContentBlocksWire")]
pub fn ai_image_content_blocks_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let images: Value = wire::read_value(r, &S_AI_IMAGE_CONTENT_BLOCKS_0)?;
        let out = &port::ai_image_content_blocks(images)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_AI_IMAGE_CONTENT_BLOCKS_OUT.inner())?;
        }
        Ok(())
    })
}

static S_BUILD_USER_CONTENT_1: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("mime", wire::Schema::Str16),
    ("data", wire::Schema::Str16),
    ("name", wire::Schema::OptJs(&wire::Schema::Str16)),
]));
static S_BUILD_USER_CONTENT_OUT: wire::Schema = wire::Schema::Dyn;

/// `buildUserContent` over the binary wire.
#[napi(js_name = "buildUserContentWire")]
pub fn build_user_content_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let text: String = r.string16()?;
        let images: Value = wire::read_value(r, &S_BUILD_USER_CONTENT_1)?;
        let out = &port::build_user_content(text, images)?;
        wire::write_value(w, out, &S_BUILD_USER_CONTENT_OUT)?;
        Ok(())
    })
}

static S_AI_CONTENT_TO_TEXT_0: wire::Schema = wire::Schema::Dyn;

/// `aiContentToText` over the binary wire.
#[napi(js_name = "aiContentToTextWire")]
pub fn ai_content_to_text_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let content: Value = wire::read_value(r, &S_AI_CONTENT_TO_TEXT_0)?;
        let out = &port::ai_content_to_text(content)?;
        w.string16(out);
        Ok(())
    })
}

static S_BUILD_SESSION_PREVIEW_OUT: wire::Schema = wire::Schema::Str16;

/// `buildSessionPreview` over the binary wire.
#[napi(js_name = "buildSessionPreviewWire")]
pub fn build_session_preview_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let text: Option<String> = r.opt_js(|r| r.string16())?;
        let max: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::build_session_preview(text, max)?;
        wire::write_value(w, out, &S_BUILD_SESSION_PREVIEW_OUT)?;
        Ok(())
    })
}

static S_PARSE_KEY_VALUE_LINES_OUT: wire::Schema = wire::Schema::Map16(&wire::Schema::Str16);

/// `parseKeyValueLines` over the binary wire.
#[napi(js_name = "parseKeyValueLinesWire")]
pub fn parse_key_value_lines_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let text: String = r.string16()?;
        let out = &port::parse_key_value_lines(text)?;
        wire::write_value(w, out, &S_PARSE_KEY_VALUE_LINES_OUT)?;
        Ok(())
    })
}
