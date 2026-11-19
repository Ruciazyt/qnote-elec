//! JS bindings for `src/shared/notes/`: generated from the signatures in `port.rs` by rust-anything.
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

/// `contentHash`.
#[napi(js_name = "contentHash")]
pub fn content_hash(content: String) -> napi::Result<String> {
    run(move || {
        let out = port::content_hash(content)?;
        Ok(out)
    })
}

/// `isCreatableNoteType`.
#[napi(js_name = "isCreatableNoteType")]
pub fn is_creatable_note_type(r#type: String) -> napi::Result<bool> {
    run(move || {
        let out = port::is_creatable_note_type(r#type)?;
        Ok(out)
    })
}

/// `isFolderNode`.
#[napi(js_name = "isFolderNode")]
pub fn is_folder_node(node: String) -> napi::Result<bool> {
    run(move || {
        let node = crate::js::from_json(&node)?;
        let out = port::is_folder_node(node)?;
        Ok(out)
    })
}

/// `getExt`.
#[napi(js_name = "getExt")]
pub fn get_ext(file_name: String) -> napi::Result<String> {
    run(move || {
        let out = port::get_ext(file_name)?;
        Ok(out)
    })
}

/// `detectNoteType`.
#[napi(js_name = "detectNoteType")]
pub fn detect_note_type(file_name: String) -> napi::Result<String> {
    run(move || {
        let out = port::detect_note_type(file_name)?;
        crate::js::to_json(&out)
    })
}

/// `isNoteFile`.
#[napi(js_name = "isNoteFile")]
pub fn is_note_file(file_name: String) -> napi::Result<bool> {
    run(move || {
        let out = port::is_note_file(file_name)?;
        Ok(out)
    })
}

/// `stripExt`.
#[napi(js_name = "stripExt")]
pub fn strip_ext(file_name: String) -> napi::Result<String> {
    run(move || {
        let out = port::strip_ext(file_name)?;
        Ok(out)
    })
}

/// `getNoteTypeMeta`.
#[napi(js_name = "getNoteTypeMeta")]
pub fn get_note_type_meta(r#type: String) -> napi::Result<String> {
    run(move || {
        let out = port::get_note_type_meta(r#type)?;
        crate::js::to_json(&out)
    })
}

/// `withDefaultExt`.
#[napi(js_name = "withDefaultExt")]
pub fn with_default_ext(raw_name: String, r#type: String) -> napi::Result<String> {
    run(move || {
        let out = port::with_default_ext(raw_name, r#type)?;
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

static S_IS_FOLDER_NODE_0: wire::Schema = wire::Schema::Dyn;

/// `isFolderNode` over the binary wire.
#[napi(js_name = "isFolderNodeWire")]
pub fn is_folder_node_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let node: serde_json::Value = wire::read_value(r, &S_IS_FOLDER_NODE_0)?;
        let out = &port::is_folder_node(node)?;
        wire::write_dyn(w, &serde_json::to_value(out).map_err(|e| e.to_string())?);
        Ok(())
    })
}

static S_DETECT_NOTE_TYPE_OUT: wire::Schema = wire::Schema::OptJs(&wire::Schema::Str16);

/// `detectNoteType` over the binary wire.
#[napi(js_name = "detectNoteTypeWire")]
pub fn detect_note_type_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let file_name: String = r.string16()?;
        let out = &port::detect_note_type(file_name)?;
        wire::write_value(w, out, &S_DETECT_NOTE_TYPE_OUT)?;
        Ok(())
    })
}

static S_GET_NOTE_TYPE_META_OUT: wire::Schema = wire::Schema::Obj(&[
    ("type", wire::Schema::Str16),
    ("label", wire::Schema::Str16),
    ("defaultExt", wire::Schema::Str16),
]);

/// `getNoteTypeMeta` over the binary wire.
#[napi(js_name = "getNoteTypeMetaWire")]
pub fn get_note_type_meta_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let r#type: String = r.string16()?;
        let out = &port::get_note_type_meta(r#type)?;
        wire::write_value(w, out, &S_GET_NOTE_TYPE_META_OUT)?;
        Ok(())
    })
}
