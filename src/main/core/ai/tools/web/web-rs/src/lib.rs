//! JS bindings for `src/main/core/ai/tools/web/`: generated from the signatures in `port.rs` by rust-anything.
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

/// `decodeEntities`.
#[napi(js_name = "decodeEntities")]
pub fn decode_entities(input: String) -> napi::Result<String> {
    run(move || {
        let out = port::decode_entities(input)?;
        Ok(out)
    })
}

/// `stripTags`.
#[napi(js_name = "stripTags")]
pub fn strip_tags(html: String) -> napi::Result<String> {
    run(move || {
        let out = port::strip_tags(html)?;
        Ok(out)
    })
}

/// `plainText`.
#[napi(js_name = "plainText")]
pub fn plain_text(html: String) -> napi::Result<String> {
    run(move || {
        let out = port::plain_text(html)?;
        Ok(out)
    })
}

/// `htmlToText`.
#[napi(js_name = "htmlToText")]
pub fn html_to_text(html: String) -> napi::Result<String> {
    run(move || {
        let out = port::html_to_text(html)?;
        Ok(out)
    })
}

/// `extractTitle`.
#[napi(js_name = "extractTitle")]
pub fn extract_title(html: String) -> napi::Result<String> {
    run(move || {
        let out = port::extract_title(html)?;
        Ok(out)
    })
}

/// `parseBingResults`.
#[napi(js_name = "parseBingResults")]
pub fn parse_bing_results(html: String, limit: f64) -> napi::Result<String> {
    run(move || {
        let out = port::parse_bing_results(html, limit)?;
        crate::js::to_json(&out)
    })
}

/// `parseBaiduResults`.
#[napi(js_name = "parseBaiduResults")]
pub fn parse_baidu_results(html: String, limit: f64) -> napi::Result<String> {
    run(move || {
        let out = port::parse_baidu_results(html, limit)?;
        crate::js::to_json(&out)
    })
}

/// `buildSearchUrl`.
#[napi(js_name = "buildSearchUrl")]
pub fn build_search_url(engine: String, query: String) -> napi::Result<String> {
    run(move || {
        let out = port::build_search_url(engine, query)?;
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

static S_PARSE_BING_RESULTS_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("title", wire::Schema::Str16),
    ("url", wire::Schema::Str16),
    ("snippet", wire::Schema::Str16),
]));

/// `parseBingResults` over the binary wire.
#[napi(js_name = "parseBingResultsWire")]
pub fn parse_bing_results_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let html: String = r.string16()?;
        let limit: f64 = r.f64()?;
        let out = &port::parse_bing_results(html, limit)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_PARSE_BING_RESULTS_OUT.inner())?;
        }
        Ok(())
    })
}

static S_PARSE_BAIDU_RESULTS_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("title", wire::Schema::Str16),
    ("url", wire::Schema::Str16),
    ("snippet", wire::Schema::Str16),
]));

/// `parseBaiduResults` over the binary wire.
#[napi(js_name = "parseBaiduResultsWire")]
pub fn parse_baidu_results_wire(len: u32) -> napi::Result<f64> {
    wire_io(len, |r, w| {
        let html: String = r.string16()?;
        let limit: f64 = r.f64()?;
        let out = &port::parse_baidu_results(html, limit)?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_PARSE_BAIDU_RESULTS_OUT.inner())?;
        }
        Ok(())
    })
}
